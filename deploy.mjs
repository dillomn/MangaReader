#!/usr/bin/env node
// deploy.mjs — deploy MangaVa from ORB (git home) to VM02 (where it runs).
//
//   node deploy.mjs            # ship tracked code + rebuild the container on VM02
//   DRYRUN=1 node deploy.mjs   # print what would happen, ship nothing
//
// How it works: ORB has the git source of truth. VM02 (192.168.1.197) runs the
// container. There are no SSH keys to the VMs (password auth only, sshpass not
// installed), so we reuse the ssh2 lib from ~/orb/node_modules and the
// ORB_SSH_PASSWORD in ~/orb/.env.local — the same pattern the homelab tooling uses.
//
// It ships ONLY git-tracked files (git ls-files), so runtime state on VM02 is
// never touched: the data/ dir, node_modules/, and the gitignored .env are left
// in place. If VM02 has no .env yet, one is seeded from .env.example. The rebuild
// uses docker-compose v1 with the ContainerConfig-KeyError workaround
// (rm -f + up -d, never a plain recreate).

import { Client } from '/home/dillon/orb/node_modules/ssh2';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HOST = process.env.VM02_HOST || '192.168.1.197';
const USER = 'dillon';
const REMOTE_DIR = '/home/dillon/MangaReader'; // VM02 folder name (repo is "MangaReader")
const SERVICE = 'mangva';
const PORT = 3001;
const DRYRUN = !!process.env.DRYRUN;

const APP_DIR = dirname(fileURLToPath(import.meta.url));

function readPassword() {
  const env = readFileSync('/home/dillon/orb/.env.local', 'utf8');
  const m = env.match(/^ORB_SSH_PASSWORD=(.*)$/m);
  if (!m) throw new Error('ORB_SSH_PASSWORD not found in ~/orb/.env.local');
  return m[1].trim().replace(/^["']|["']$/g, '');
}

function connect(password) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn));
    conn.on('error', reject);
    conn.connect({ host: HOST, port: 22, username: USER, password, readyTimeout: 20000 });
  });
}

// Run a remote command, streaming output. Rejects on non-zero exit.
function run(conn, cmd, { quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream.on('data', (d) => { out += d; if (!quiet) process.stdout.write(d); });
      stream.stderr.on('data', (d) => { out += d; if (!quiet) process.stderr.write(d); });
      stream.on('close', (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(`remote command exited ${code}: ${cmd}`));
      });
    });
  });
}

async function main() {
  // Build a tarball of git-tracked files only (excludes data/, node_modules/, .env).
  const files = execSync('git ls-files', { cwd: APP_DIR, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  console.log(`▶ ${DRYRUN ? '[DRYRUN] ' : ''}deploying ${files.length} tracked files → ${USER}@${HOST}:${REMOTE_DIR}`);
  const tarB64 = execSync('git ls-files -z | tar --null -czf - -T -', {
    cwd: APP_DIR, maxBuffer: 256 * 1024 * 1024,
  }).toString('base64');

  if (DRYRUN) {
    console.log('[DRYRUN] would upload tarball, seed .env if missing, then on VM02:');
    console.log(`  cd ${REMOTE_DIR} && docker-compose build ${SERVICE} && docker rm -f ${SERVICE} && docker-compose up -d ${SERVICE}`);
    return;
  }

  const conn = await connect(readPassword());
  try {
    await run(conn, `mkdir -p ${REMOTE_DIR}`);

    // Upload + extract tracked files over the remote working tree.
    console.log('▶ uploading code…');
    await run(conn, `cat > /tmp/mangva-deploy.tgz.b64 <<'EOF_B64'\n${tarB64}\nEOF_B64`, { quiet: true });
    await run(conn, `base64 -d /tmp/mangva-deploy.tgz.b64 | tar xzf - -C ${REMOTE_DIR} && rm -f /tmp/mangva-deploy.tgz.b64`);

    // Seed .env from .env.example on first deploy (never overwrite an existing one).
    await run(conn, `cd ${REMOTE_DIR} && [ -f .env ] && echo ".env present — leaving it" || (cp .env.example .env && echo "seeded .env from .env.example")`);

    // Rebuild + recreate. docker-compose v1 (1.29.2) → rm -f before up -d.
    console.log('▶ rebuilding image…');
    await run(conn, `cd ${REMOTE_DIR} && docker-compose build ${SERVICE}`);
    console.log('▶ recreating container…');
    await run(conn, `cd ${REMOTE_DIR} && docker rm -f ${SERVICE} 2>/dev/null; docker-compose up -d ${SERVICE}`);

    // Verify.
    console.log('▶ verifying…');
    await run(conn, `sleep 2; docker ps --filter name=^${SERVICE}$ --format '  up: {{.Names}} {{.Status}} {{.Ports}}'`);
    const health = await run(conn, `curl -s -o /dev/null -w '%{http_code}' http://localhost:${PORT}/ || true`, { quiet: true });
    console.log(`  http://localhost:${PORT}/ → HTTP ${health.trim()}`);
    console.log('✔ deploy complete');
  } finally {
    conn.end();
  }
}

main().catch((e) => { console.error('✖ deploy failed:', e.message); process.exit(1); });

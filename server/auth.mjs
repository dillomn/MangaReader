import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getUserByUsername, DATA_DIR } from './db.mjs'

// Resolve a JWT signing secret. Prefer the env var; otherwise generate a
// strong random secret once and persist it to data/.jwt-secret so tokens
// survive restarts (e.g. after a power cut). Never fall back to a hardcoded
// default — a committed default lets anyone forge admin tokens.
function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET

  const secretFile = join(DATA_DIR, '.jwt-secret')
  try {
    if (existsSync(secretFile)) {
      const saved = readFileSync(secretFile, 'utf8').trim()
      if (saved) return saved
    }
    const generated = randomBytes(48).toString('hex')
    writeFileSync(secretFile, generated, { mode: 0o600 })
    console.warn('[auth] JWT_SECRET not set — generated a persistent random secret at data/.jwt-secret')
    return generated
  } catch (err) {
    // Couldn't read/write the file (e.g. read-only FS): use an ephemeral
    // secret so the server still starts, but warn that tokens won't persist.
    console.warn(`[auth] could not persist a JWT secret (${err.message}) — using an ephemeral one; users will be signed out on restart`)
    return randomBytes(48).toString('hex')
  }
}

const JWT_SECRET = resolveJwtSecret()
const JELLYFIN_URL = (process.env.JELLYFIN_URL || '').replace(/\/$/, '')

export const JELLYFIN_ENABLED = !!process.env.JELLYFIN_URL

if (!JELLYFIN_ENABLED) {
  console.warn('[auth] Jellyfin disabled — using local authentication only.')
}

export async function validateJellyfinCredentials(username, password) {
  if (!JELLYFIN_ENABLED) return null
  const res = await fetch(`${JELLYFIN_URL}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': 'MediaBrowser Client="Mangva", Device="Server", DeviceId="mangva-server", Version="1.0.0"',
    },
    body: JSON.stringify({ Username: username, Pw: password }),
  })

  if (!res.ok) return null

  const data = await res.json()
  return {
    id: data.User.Id,
    username: data.User.Name,
    isAdmin: data.User.Policy?.IsAdministrator ?? false,
  }
}

export async function validateLocalCredentials(username, password) {
  const user = getUserByUsername(username)
  if (!user?.passwordHash) return null
  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) return null
  return { id: user.id, username: user.username, isAdmin: user.isAdmin }
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12)
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, isAdmin: user.isAdmin },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '30d' },
  )
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })
  } catch {
    return null
  }
}

export function extractToken(req) {
  const auth = req.headers['authorization']
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  return null
}

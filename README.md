# MangaReader

A self-hosted manga reader that pulls chapters from **MangaDex** and **Mangapill**, with offline download support and PDF export.

---

## Features

- **Dual source** — fetches chapters from MangaDex and Mangapill simultaneously and auto-selects whichever has more chapters. Switch sources per-manga with a single click; your choice is remembered.
- **Smart auto-detection** — chapter counts for both sources are shown on every manga page so you can see at a glance which source is better before switching.
- **Full reader** — vertical scroll reader with lazy-loaded images, previous/next chapter navigation, and a chapter list shortcut.
- **Offline downloads** — save any chapter to your browser's IndexedDB for reading without an internet connection. Progress bar with cancel support; stuck downloads auto-reset to retryable on next load.
- **Bulk save** — download all chapters of a manga in one click.
- **PDF export** — export any downloaded chapter as a PDF, or export all downloaded chapters as a ZIP archive.
- **Catalogue & Library** — browse/search MangaDex with sort options (Most Popular, Latest Update, New Releases). Saved manga appear in the Library.
- **Volume badges** — volume numbers shown on chapter lists when a manga has multiple volumes.

---

## Requirements

| Requirement | Version |
|---|---|
| Node.js | 18.x (Vite 4 is pinned — do **not** upgrade to Vite 5+ without upgrading Node first) |
| Google Chrome | Any recent stable build |
| npm | 8+ |

Chrome must be installed on the machine running the proxy. It is used headlessly by Puppeteer to scrape Mangapill (which blocks plain HTTP requests).

---

## First-Time Setup

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
```

### 2. Install dependencies

```bash
npm install
```

### 3. Verify Chrome is found

The proxy auto-detects Chrome in the standard Windows installation paths. If Chrome is installed somewhere else, set the environment variable before starting the proxy:

```bash
# Windows (PowerShell)
$env:CHROME_PATH = "C:\Path\To\chrome.exe"

# Linux / macOS
export CHROME_PATH="/usr/bin/google-chrome"
```

### 4. Start both servers

Open **two terminals** and run one command in each:

```bash
# Terminal 1 — Mangapill proxy (port 3001)
npm run proxy

# Terminal 2 — Frontend dev server (port 5173)
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

> The proxy must be running whenever you want to use Mangapill chapters or load images from it. MangaDex works without the proxy.

---

## How It Works

### Architecture

```
Browser (React SPA)
    │
    ├─► MangaDex REST API  (api.mangadex.org)  — no auth, CORS-open
    │
    └─► Local Proxy  (localhost:3001)
            │
            └─► Mangapill  (mangapill.com)
                    Puppeteer + headless Chrome handles JS rendering
                    and adds the correct Referer header for CDN images
```

### Chapter loading

1. When you open a manga page both sources are queried in parallel.
2. The source with more chapters is selected automatically.
3. You can override the selection with the **MangaDex / Mangapill** toggle; the choice is saved in `localStorage` keyed by manga ID.

### Image proxy

Mangapill's CDN blocks direct browser requests (hotlink protection). The local proxy fetches images server-side with `Referer: https://mangapill.com/` and streams them to the browser, so images load without any browser-side workarounds.

### Offline storage

Downloads are stored in **IndexedDB** as raw image blobs, keyed by `{chapterId}-{pageIndex}`. A separate `downloads` store tracks metadata (status, progress, total pages). When the reader detects a chapter is downloaded it creates `object://` URLs from the blobs — the API is never hit for downloaded chapters.

---

## Home Server Deployment

### 1. Build the frontend

The Mangapill proxy URL is baked into the frontend at build time. Before building, tell Vite where the proxy will live:

```bash
# If the proxy runs on the same machine and you reverse-proxy /mangapill → :3001
# no env var is needed — the default http://localhost:3001/mangapill works.

# If the proxy is on a different host or port, set this before building:
VITE_MANGAPILL_API=http://192.168.1.100:3001/mangapill npm run build
```

This produces a `dist/` folder of static files.

### 2. Serve the static files

Any static file server works. Examples:

**Using `serve` (quickest)**
```bash
npx serve dist
```

**Using nginx**
```nginx
server {
    listen 80;
    server_name manga.yourdomain.local;

    root /path/to/MangaReader/dist;
    index index.html;

    # Required for React Router — all routes must return index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Optional: reverse-proxy the Mangapill proxy so the frontend
    # can use a relative URL and you don't need to set VITE_MANGAPILL_API
    location /mangapill/ {
        proxy_pass http://127.0.0.1:3001/mangapill/;
    }
}
```

### 3. Run the proxy as a background service

**Using PM2 (recommended)**
```bash
npm install -g pm2
pm2 start proxy.mjs --name manga-proxy
pm2 save          # persist across reboots
pm2 startup       # generate the startup script for your OS
```

**Using a systemd unit (Linux)**
```ini
# /etc/systemd/system/manga-proxy.service
[Unit]
Description=MangaReader Mangapill proxy
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/MangaReader
ExecStart=/usr/bin/node proxy.mjs
Restart=on-failure
Environment=CHROME_PATH=/usr/bin/google-chrome

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable --now manga-proxy
```

### 4. Ports summary

| Service | Default port | Configurable |
|---|---|---|
| Frontend dev server | 5173 | `vite --port XXXX` |
| Mangapill proxy | 3001 | Edit `PORT` in `proxy.mjs` |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VITE_MANGAPILL_API` | `http://localhost:3001/mangapill` | Base URL of the Mangapill proxy, baked in at build time |
| `CHROME_PATH` | Auto-detected | Full path to the Chrome executable used by the proxy |

---

## Scripts

```bash
npm run dev      # Start Vite dev server
npm run proxy    # Start Mangapill proxy
npm run build    # Type-check + production build → dist/
npm run preview  # Preview the production build locally
```

---

## Updating

```bash
git pull
npm install      # pick up any new/changed dependencies
npm run build    # rebuild if deploying to home server
```

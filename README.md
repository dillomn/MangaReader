# MangaReader

A self-hosted manga reader with offline downloads, read progress tracking, Jellyfin authentication, and an admin portal.

---

## Features

- **Dual source** — fetches chapters from MangaDex and Mangapill simultaneously, auto-selects whichever has more chapters. Switch sources per-manga; choice is remembered.
- **Page-by-page reader** — with double-spread detection, click-zone navigation, and keyboard arrow key support.
- **Offline downloads** — save chapters to your browser's IndexedDB for reading without internet. Bulk save all chapters in one click.
- **PDF / ZIP export** — export any downloaded chapter as a PDF or all downloaded chapters as a ZIP archive.
- **Read progress** — resumes from last page, shows "Read" and in-progress tags on chapter lists.
- **Explore** — browse by genre and theme tags.
- **Jellyfin login** — sign in with your existing Jellyfin credentials. Jellyfin admins automatically get admin access in MangaReader.
- **Admin portal** — server health, user activity (which manga each user saved), cache management, announcement banner.
- **Works remotely** — via LAN IP or Cloudflare Tunnel without any extra config.

---

## Requirements

| Requirement | Version |
|---|---|
| Node.js | 18.x (Vite 4 pinned — do **not** upgrade to Vite 5+ without upgrading Node) |
| Google Chrome | Any recent stable build |
| Jellyfin | Any recent version |

Chrome is used headlessly by Puppeteer to scrape Mangapill.

---

## First-Time Setup

### 1. Clone and install

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
npm install
```

### 2. Set environment variables

Before starting the proxy, set these in your terminal:

**PowerShell (Windows)**
```powershell
$env:JELLYFIN_URL = "http://192.168.1.196:8096"
$env:JWT_SECRET   = "your-random-secret"
```

**Bash / Linux**
```bash
export JELLYFIN_URL=http://192.168.1.196:8096
export JWT_SECRET=your-random-secret
```

Generate a secure JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

See `.env.example` for all available variables.

### 3. Start both servers

Open **two terminals**:

```bash
# Terminal 1 — proxy (port 3001): Mangapill scraper + auth + admin API
npm run proxy

# Terminal 2 — frontend (port 5173)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and sign in with your Jellyfin credentials.

---

## Authentication

- Login uses your Jellyfin username and password
- Jellyfin admins automatically get admin access in MangaReader
- JWTs are valid for 30 days and stored in `localStorage`
- Tokens are verified server-side on every protected API call
- User login history stored in `data/users.json`

---

## Admin Portal

Accessible at `/admin` (Jellyfin admins only). Click your username in the top-right corner → **Admin Portal**.

### Health tab
Real-time proxy stats: uptime, Node.js version, memory usage, current Mangapill cache entry count.

### Users tab
Lists every user who has logged in with their last seen time and how many chapters they've saved offline. **Click any user row** to expand and see which manga they've downloaded, grouped by title with chapter numbers shown as tags.

### Cache tab

The proxy caches Mangapill scrape results **in memory only**:

| Cache type | TTL |
|---|---|
| Search results | 5 minutes |
| Chapter lists | 5 minutes |
| Chapter page image URLs | 1 hour |

**Clearing the cache only affects these in-memory Mangapill results.** It does not touch downloaded chapters (stored in each user's browser IndexedDB), read progress (localStorage), or any user/activity data.

Use this if Mangapill chapters are stale or showing outdated results after a new release.

### Announcement tab
Set a banner message shown to all users at the top of every page. Banners are dismissible per browser session. Leave empty to show nothing.

---

## Accessing from Other Devices (LAN / Cloudflare Tunnel)

All external API calls are proxied through the Vite dev server, so the app works from any domain or IP without CORS issues. No additional configuration needed.

1. Start both servers as normal
2. Access via your LAN IP: `http://192.168.1.x:5173`
3. Or add a Cloudflare Tunnel pointing to `http://localhost:5173`

To restrict access, enable Cloudflare Zero Trust email OTP on the tunnel.

### Chrome path (if not auto-detected)

```powershell
$env:CHROME_PATH = "C:\Path\To\chrome.exe"
```

---

## Home Server Deployment

### Run the proxy as a service

**PM2 (recommended)**
```bash
npm install -g pm2
JELLYFIN_URL=http://192.168.1.196:8096 JWT_SECRET=your-secret pm2 start proxy.mjs --name manga-proxy
pm2 save
pm2 startup
```

**systemd (Linux)**
```ini
# /etc/systemd/system/manga-proxy.service
[Unit]
Description=MangaReader proxy
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/MangaReader
ExecStart=/usr/bin/node proxy.mjs
Restart=on-failure
Environment=JELLYFIN_URL=http://192.168.1.196:8096
Environment=JWT_SECRET=your-random-secret
Environment=CHROME_PATH=/usr/bin/google-chrome

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable --now manga-proxy
```

### Ports

| Service | Default port |
|---|---|
| Frontend dev server | 5173 |
| Proxy (Mangapill + auth + admin API) | 3001 |

---

## Project Structure

```
proxy.mjs          — Node.js HTTP server (Mangapill + auth + admin API)
server/
  auth.mjs         — Jellyfin credential validation + JWT sign/verify
  db.mjs           — JSON-file persistence (users, announcements, activity)
data/              — Runtime data (auto-created, gitignored)
  users.json       — Login history
  announcement.json — Active banner message
  activity.json    — Per-user download history
src/
  pages/
    Catalogue.tsx      Browse / search manga
    Explore.tsx        Browse by genre and theme tags
    MangaDetail.tsx    Manga info + chapter list
    Reader.tsx         Page-by-page reader
    Library.tsx        Offline downloaded chapters
    Login.tsx          Jellyfin login form
    Admin.tsx          Admin portal (Health / Users / Cache / Announcement)
  context/
    AuthContext.tsx         Jellyfin auth state + JWT management
    DownloadContext.tsx     Chapter download queue + IndexedDB
    ReadProgressContext.tsx Per-chapter read progress (localStorage)
  components/
    Layout/                App shell, nav bar, user menu
    AnnouncementBanner/    Top-of-page admin announcement
    MangaCard/             Catalogue grid card
    DownloadButton/        Per-chapter download/status button
  services/
    mangadex.ts    MangaDex API client
    mangapill.ts   Mangapill API client (via proxy)
    storage.ts     IndexedDB helpers for offline pages
    download.ts    PDF / ZIP export
  utils/
    api.ts         authFetch helper (injects Bearer token automatically)
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `JELLYFIN_URL` | `http://localhost:8096` | Jellyfin server URL (no trailing slash) |
| `JWT_SECRET` | *(insecure default)* | Secret for signing JWTs — **always set this in production** |
| `CHROME_PATH` | Auto-detected | Full path to Chrome executable |

---

## Data Storage

| Data | Storage | Location |
|---|---|---|
| Downloaded chapter pages | IndexedDB | Each user's browser |
| Read progress | localStorage | Each user's browser |
| User login history | JSON file | `data/users.json` (server) |
| Download activity | JSON file | `data/activity.json` (server) |
| Announcement | JSON file | `data/announcement.json` (server) |
| Auth tokens | localStorage | Each user's browser |

---

## Scripts

```bash
npm run dev      # Start Vite dev server (port 5173)
npm run proxy    # Start proxy server (port 3001)
npm run build    # Type-check + production build → dist/
npm run preview  # Preview the production build locally
```

---

## Updating

```bash
git pull
npm install
# If deploying to home server:
npm run build
```

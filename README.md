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
- **Flexible login** — sign in with Jellyfin credentials, or use local accounts managed entirely within MangaReader (no Jellyfin required).
- **Admin portal** — server health, user activity (which manga each user saved), cache management, announcement banner, local user management.
- **Works remotely** — via LAN IP or Cloudflare Tunnel without any extra config.

---

## Requirements

| Requirement | Version |
|---|---|
| Node.js | 18.x (Vite 4 pinned — do **not** upgrade to Vite 5+ without upgrading Node) |
| Google Chrome | Any recent stable build |
| Jellyfin | Optional — only needed if using Jellyfin login |

Chrome is used headlessly by Puppeteer to scrape Mangapill.

---

## First-Time Setup

### 1. Clone and install

```bash
git clone https://github.com/dillomn/MangaReader.git
cd MangaReader
npm install
```

### 2. Set environment variables

Before starting the proxy, set these in your terminal:

**macOS / Linux (bash/zsh)**
```bash
export JELLYFIN_URL=http://192.168.1.196:8096   # omit if not using Jellyfin
export JWT_SECRET=your-random-secret
```

**Windows (PowerShell)**
```powershell
$env:JELLYFIN_URL = "http://192.168.1.196:8096"  # omit if not using Jellyfin
$env:JWT_SECRET   = "your-random-secret"
```

Generate a secure JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Set Chrome path

The proxy auto-detects Chrome on Windows. On macOS and Linux you need to set `CHROME_PATH`.

| Platform | Default path |
|---|---|
| macOS | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |
| Linux | `/usr/bin/google-chrome` |
| Windows | `C:\Program Files\Google\Chrome\Application\chrome.exe` (auto-detected) |

**macOS / Linux**
```bash
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# or on Linux:
export CHROME_PATH=/usr/bin/google-chrome
```

**Windows (PowerShell)**
```powershell
$env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

### 4. Start both servers

Open **two terminals**:

```bash
# Terminal 1 — proxy (port 3001): Mangapill scraper + auth + admin API
npm run proxy

# Terminal 2 — frontend (port 5173)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

- **With Jellyfin:** sign in with your Jellyfin credentials.
- **Without Jellyfin:** you'll be redirected to a first-run setup page to create your admin account.

---

## Authentication

MangaReader supports two auth modes that can run side by side:

| Mode | How it works |
|---|---|
| **Jellyfin** | Set `JELLYFIN_URL`. Users log in with Jellyfin credentials. Jellyfin admins are automatically admins in MangaReader. |
| **Local** | No `JELLYFIN_URL` needed. On first run a setup page prompts you to create an admin account. Admins can then create additional local users from the Admin Portal. |

- JWTs are valid for 30 days and stored in `localStorage`
- Tokens are verified server-side on every protected API call
- User login history stored in `data/users.json`

---

## Admin Portal

Accessible at `/admin`. Click your username in the top-right corner → **Admin Portal**.

### Health tab
Real-time proxy stats: uptime, Node.js version, memory usage, current Mangapill cache entry count.

### Users tab
Lists every user with their last seen time and how many chapters they've saved offline. **Click any user row** to expand and see which manga they've downloaded.

Admins can also **create local user accounts** directly from this tab — useful for sharing access without requiring Jellyfin accounts.

### Cache tab

The proxy caches Mangapill scrape results **in memory only**:

| Cache type | TTL |
|---|---|
| Search results | 5 minutes |
| Chapter lists | 5 minutes |
| Chapter page image URLs | 1 hour |

**Clearing the cache only affects these in-memory Mangapill results.** It does not touch downloaded chapters (stored in each user's browser IndexedDB), read progress (localStorage), or any user/activity data.

### Announcement tab
Set a banner message shown to all users at the top of every page. Banners are dismissible per browser session. Leave empty to show nothing.

---

## Accessing from Other Devices (LAN / Cloudflare Tunnel)

All external API calls are proxied through the Vite dev server, so the app works from any domain or IP without CORS issues. No additional configuration needed.

1. Start both servers as normal
2. Access via your LAN IP: `http://192.168.1.x:5173`
3. Or add a Cloudflare Tunnel pointing to `http://localhost:5173`

To restrict access, enable Cloudflare Zero Trust email OTP on the tunnel.

---

## Home Server Deployment

### Run the proxy as a service

**PM2 (recommended)**
```bash
npm install -g pm2
JELLYFIN_URL=http://192.168.1.196:8096 JWT_SECRET=your-secret CHROME_PATH=/usr/bin/google-chrome pm2 start proxy.mjs --name manga-proxy
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
  auth.mjs         — Jellyfin + local credential validation + JWT sign/verify
  db.mjs           — JSON-file persistence (users, announcements, activity)
data/              — Runtime data (auto-created, gitignored)
  users.json       — Login history + local user accounts
  announcement.json — Active banner message
  activity.json    — Per-user download history
src/
  pages/
    Catalogue.tsx      Browse / search manga
    Explore.tsx        Browse by genre and theme tags
    MangaDetail.tsx    Manga info + chapter list
    Reader.tsx         Page-by-page reader
    Library.tsx        Offline downloaded chapters
    Login.tsx          Login form
    Setup.tsx          First-run admin account creation
    Admin.tsx          Admin portal (Health / Users / Cache / Announcement)
  context/
    AuthContext.tsx         Auth state + JWT management
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
public/
  sw.js          Service worker: caches MangaDex CDN images locally
```

---

## Page Cache Service Worker

`public/sw.js` runs in every reader tab and caches MangaDex CDN image responses
(`*.mangadex.network/data/...` and `/data-saver/...`) using a cache-first
strategy. Once a page loads successfully, it's preserved locally and survives
later CDN backend evictions — MangaDex's at-home network occasionally returns
404 for files that exist at origin but were dropped from a regional node's
cache, and without local caching those pages become unreadable until someone
warms the node again. mangadex.org uses the same approach.

The cache key strips the at-home node hostname (`/data/HASH/FILENAME` only),
so a page cached from one session's node URL is reused even if the at-home
API hands us a different node next session.

**Dev tip:** if you change image-related code and the browser keeps serving
stale responses, unregister the SW from DevTools → Application → Service
Workers, or bump the `CACHE` version string in `public/sw.js` to invalidate
all entries on the next page load.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `JELLYFIN_URL` | *(not set)* | Jellyfin server URL. If omitted, local-only auth is used. |
| `JWT_SECRET` | *(insecure default)* | Secret for signing JWTs — **always set this in production** |
| `CHROME_PATH` | Auto-detected (Windows only) | Full path to Chrome executable — required on macOS and Linux |

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


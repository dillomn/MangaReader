# Changelog

All notable changes to Mangva, newest first.

## v1.8.0 — 2026-06-10

### Features

- New **What's New** page — open it any time from the profile menu (you're probably reading it there right now)

## v1.7.1 — 2026-06-10

### Fixes

- Gold Split loads much faster — pages are now served at reading resolution (~3.5× smaller) instead of full print size
- Slow repeat reads: manga pages from Mangapill and Gold Split are now cached after first view, so re-reading loads instantly
- Admin portal: fixed manga showing as "Unknown title" in users' reading activity
- Discord link embeds now work when sharing manga links (crawlers were being blocked in front of the app)

## v1.7.0 — 2026-06-10

### Features

- **Gold Split** by greasequeen joins the catalogue (shared with permission) — read, download, and track it like any other manga
- **Discord link embeds** — sharing a manga or chapter link shows its cover, title, and chapter number
- Admin portal now shows what each user is **reading** — last chapter read and when, alongside their saved and library manga

## v1.6.1 — 2026-05-12

### Fixes

- Proper "page not found" screen instead of a blank page
- Better error handling when a Catalogue search fails

## v1.6.0 — 2026-05-08

### Features

- Renamed to **Mangva**
- A "New version available — Refresh" pill now appears when an update is deployed
- Library bookmarks are saved to your account and sync across devices

### Fixes

- Sort tab layout issues on smaller screens
- Improved keyboard focus states for accessibility

## v1.5.0 — 2026-05-06

### Features

- Read progress syncs to the server — pick up where you left off on another device
- Once a page loads successfully it's cached on your device and keeps working even if the source goes down
- Manga page redesign: better cover layout, action buttons, and chapter controls

### Fixes

- Far fewer broken pages: failed pages automatically retry through fresh CDN servers, with a server-side fallback as a last resort

## v1.4.0 — 2026-05-01

### Features

- Upcoming pages preload in the background while you read

### Fixes

- More reliable MangaDex loading — broken image servers are detected, reported, and swapped automatically

## v1.3.0 — 2026-04-30

### Features

- Save manga to your **Library** from any manga page
- Mobile-friendly navigation with a hamburger menu

### Fixes

- Security hardening: login rate limiting, stricter input validation, tighter CORS rules

## v1.2.0 — 2026-04-28

### Features

- **Sign in** with Jellyfin credentials or a local account — first run walks you through creating the admin
- **Read progress**: chapters show Read / in-progress tags and resume from your last page
- **Admin portal**: server health, user activity, cache management
- Self-hosting deployment guide

## v1.1.0 — 2026-04-26

### Features

- **Dual sources**: chapters fetched from both MangaDex and Mangapill — whichever has more wins, switchable per manga
- **Explore** page: browse by genre and theme tags
- Access from other devices via LAN or Cloudflare Tunnel

## v1.0.0 — 2026-04-24

### Features

- First release: browse and search the MangaDex catalogue
- Page-by-page reader with click zones and arrow-key navigation
- Offline chapter downloads saved to your browser
- Library page for downloaded manga

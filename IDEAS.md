# Mangva — Ideas & Future Features

## UX / Reading Experience

- **Continue Reading section** — show the last 3–5 manga you opened on the home/catalogue page with a resume button. Data already exists in `readStatuses` (localStorage), just needs a UI component.

- **Chapter preloading** — the reader currently preloads 2 pages ahead. Preloading 5–6 pages (or fetching the entire chapter into blobs on first load) would make page turns feel instant, especially on slower connections.

- **Reading stats on manga detail** — a "X / Y chapters read" progress bar above the chapter list. Purely frontend, data already exists in `ReadProgressContext`.

- **Double-tap to zoom** — in the page reader, double-tap to zoom in on a panel. Useful for dense pages on mobile.

- **Long-strip / webtoon mode** — vertical scroll mode for webtoons (manhwa/manhua that are one continuous strip). Toggle per-chapter or detected automatically by aspect ratio.

---

## Library / Offline

- **Downloaded chapters sync across devices** — bookmarks now sync via the server, but IndexedDB downloads are still per-browser. Storing downloaded pages server-side (or tracking download metadata so users know what to re-download) would complete the sync story.

- **Storage usage indicator** — show total IndexedDB size used in the Library page and warn before hitting browser storage limits.

- **Auto-download new chapters** — if a manga is bookmarked, check for new chapters on load and offer to auto-download them.

---

## Discovery

- **Recommendations** — "If you liked X, try Y" based on shared genres/tags. Could be purely tag-based and run client-side.

- **Reading history page** — a dedicated page showing all manga you've read, ordered by last read, with resume links. `readStatuses` already has timestamps.

- **Random from library** — a "Surprise me" button that picks a random bookmarked manga you haven't finished.

---

## Infrastructure / Deployment

- **Docker deployment** — a `Dockerfile` running `npm run proxy` + serving the Vite build via a static file server. Makes self-hosting much cleaner than running two terminal windows. A `docker-compose.yml` could wire up volumes for `data/` persistence.

- **Environment variable file** — support a `.env` file loaded by the proxy so users don't need to export vars in their shell every session.

- **Push notifications** — notify users (browser push or Ntfy/Gotify webhook) when a new chapter drops for a bookmarked manga. Would need a background job on the server that polls MangaDex.

---

## What's New / Changelog

- **Version history modal** — a "What's New" entry in the user profile dropdown (next to Sign out) that opens a modal showing recent version history: version number, date, and bullet points for additions, fixes, and changes. Content could live in a static `CHANGELOG.md` or a `data/changelog.json` served by the proxy so it can be updated without a frontend redeploy. Could also auto-open (once per version, tracked in localStorage) when a new SW version is detected — tying into the existing update banner flow.

---

## Admin

- **Per-user reading stats in Admin Portal** — show chapters read, total pages read, last active, favourite genres per user. Data could be derived from `readStatuses` if it were server-synced.

- **Announcement scheduling** — let admins set a start/end time for announcements instead of manually clearing them.

export interface Bookmark {
  mangaId: string
  mangaTitle: string
  coverUrl: string
  savedAt: string
}

const KEY = 'manga-bookmarks'

export function getBookmarks(): Record<string, Bookmark> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} }
}

export function saveBookmark(mangaId: string, mangaTitle: string, coverUrl: string): void {
  const all = getBookmarks()
  if (!all[mangaId]) {
    all[mangaId] = { mangaId, mangaTitle, coverUrl, savedAt: new Date().toISOString() }
    localStorage.setItem(KEY, JSON.stringify(all))
  }
}

export function removeBookmark(mangaId: string): void {
  const all = getBookmarks()
  delete all[mangaId]
  localStorage.setItem(KEY, JSON.stringify(all))
}

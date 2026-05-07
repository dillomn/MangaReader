import { authFetch } from '../utils/api'

export interface Bookmark {
  mangaId: string
  mangaTitle: string
  coverUrl: string
  savedAt: string
}

export async function fetchLibrary(): Promise<Record<string, Bookmark>> {
  try {
    const res = await authFetch('/api/activity/library')
    if (!res.ok) return {}
    const data = await res.json()
    return Object.fromEntries(
      (data.library ?? []).map((b: { mangaId: string; mangaTitle: string; coverUrl: string; addedAt: string }) => [
        b.mangaId,
        { mangaId: b.mangaId, mangaTitle: b.mangaTitle, coverUrl: b.coverUrl, savedAt: b.addedAt },
      ]),
    )
  } catch {
    return {}
  }
}

export async function saveBookmark(mangaId: string, mangaTitle: string, coverUrl: string): Promise<void> {
  await authFetch('/api/activity/library', {
    method: 'POST',
    body: JSON.stringify({ mangaId, mangaTitle, coverUrl }),
  })
}

export async function removeBookmark(mangaId: string): Promise<void> {
  await authFetch('/api/activity/library', {
    method: 'DELETE',
    body: JSON.stringify({ mangaId }),
  })
}

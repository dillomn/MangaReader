import type { Chapter } from '../types'

// Local proxy (proxy.mjs) handles CORS and redirect-following.
// Override with VITE_COMICK_API env var when deploying to production.
const BASE = (import.meta.env.VITE_COMICK_API as string | undefined) ?? 'http://localhost:3001/comick'

// ---- Raw API shapes ----

interface CCSearchResult {
  hid: string
  title: string
}

interface CCChapter {
  hid: string
  chap: string | null
  vol: string | null
  title: string | null
  group_name?: string[]
  created_at: string
}

interface CCChapterList {
  chapters: CCChapter[]
  total: number
}

interface CCImage {
  url?: string | null
  b2key: string
}

interface CCChapterDetail {
  chapter: {
    images: CCImage[]
  }
}

// ---- Helpers ----

function imageUrl(img: CCImage): string {
  return img.url ?? `https://meo.comick.pictures/${img.b2key}`
}

function mapChapter(cc: CCChapter): Chapter {
  return {
    id: `comick:${cc.hid}`,
    number: parseFloat(cc.chap ?? '0'),
    title: cc.title || `Chapter ${cc.chap ?? '?'}`,
    volume: cc.vol ?? undefined,
    uploadedAt: cc.created_at.split('T')[0],
    pages: 0,
    scanlationGroup: cc.group_name?.[0],
    source: 'comick',
  }
}

async function apiFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`ComicK ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

// ---- Public API ----

export async function findMangaHid(title: string): Promise<string | null> {
  const raw = await apiFetch<unknown>('/v1.0/search', {
    q: title.trim(),
    tachiyomi: 'true',
    limit: '5',
  })
  console.log('[ComicK] search response for', title, raw)
  // API may return a plain array or a wrapped object
  const results: CCSearchResult[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown>)?.['comics'])
      ? ((raw as Record<string, unknown>)['comics'] as CCSearchResult[])
      : []
  return results[0]?.hid ?? null
}

export async function getComickChapters(hid: string): Promise<Chapter[]> {
  const allChapters: CCChapter[] = []
  let page = 1
  const limit = 300

  while (true) {
    const data = await apiFetch<CCChapterList>(`/comic/${hid}/chapters`, {
      lang: 'en',
      page: String(page),
      limit: String(limit),
      tachiyomi: 'true',
    })
    allChapters.push(...data.chapters)
    if (allChapters.length >= data.total || data.chapters.length < limit) break
    page++
  }

  const seen = new Set<number>()
  return allChapters
    .map(mapChapter)
    .filter((ch) => {
      if (seen.has(ch.number)) return false
      seen.add(ch.number)
      return true
    })
    .sort((a, b) => a.number - b.number)
}

export async function getComickChapterPages(chapterHid: string): Promise<string[]> {
  const data = await apiFetch<CCChapterDetail>(`/chapter/${chapterHid}`, {
    tachiyomi: 'true',
  })
  return data.chapter.images.map(imageUrl)
}

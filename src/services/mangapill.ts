import type { Chapter } from '../types'

const BASE = (import.meta.env.VITE_MANGAPILL_API as string | undefined) ?? 'http://localhost:3001/mangapill'

interface MPResult {
  title: string
  url: string
  cover: string
}

interface MPRawChapter {
  url: string
  name: string
  chap: string | null
  vol: string | null
}

async function proxyFetch(path: string): Promise<Response> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`Mangapill proxy ${res.status}: ${path}`)
  return res
}

export async function findMangapillManga(title: string): Promise<MPResult | null> {
  const res = await proxyFetch(`/search?q=${encodeURIComponent(title.trim())}`)
  const results = (await res.json()) as MPResult[]
  console.log('[Mangapill] search for', title, results)
  return results[0] ?? null
}

export async function getMangapillChapters(mangaPath: string): Promise<Chapter[]> {
  const res = await proxyFetch(`/chapters?path=${encodeURIComponent(mangaPath)}`)
  const raw = (await res.json()) as MPRawChapter[]
  console.log('[Mangapill] chapters for', mangaPath, raw.length)

  // Extract the numeric chapter code from a mangapill URL, e.g. /chapters/1336-10001000/... → 10001000
  // Code format: (volume * 10000 + chapter) * 1000, so lower code = earlier volume = preferred
  const urlCode = (url: string) => parseInt(url.match(/-(\d+)\//)?.[1] ?? '0', 10)

  const seen = new Set<number>()
  const chapters = raw
    .map((ch): Chapter => ({
      id: `mangapill:${ch.url}`,
      number: parseFloat(ch.chap ?? '0'),
      title: ch.name || `Chapter ${ch.chap ?? '?'}`,
      volume: ch.vol ?? undefined,
      uploadedAt: '',
      pages: 0,
      source: 'mangapill',
    }))
    .sort((a, b) => a.number - b.number || urlCode(a.id) - urlCode(b.id))
    .filter((ch) => {
      if (seen.has(ch.number)) return false
      seen.add(ch.number)
      return true
    })

  // Only show volume badges when there are genuinely multiple volumes
  const distinctVols = new Set(chapters.map(c => c.volume).filter(Boolean))
  if (distinctVols.size <= 1) chapters.forEach(c => { c.volume = undefined })

  return chapters
}

export async function getMangapillChapterPages(chapterPath: string): Promise<string[]> {
  const res = await proxyFetch(`/pages?path=${encodeURIComponent(chapterPath)}`)
  const urls = (await res.json()) as string[]
  // Proxy each image through localhost so the CDN receives the correct Referer
  return urls.map(url => `${BASE}/img?url=${encodeURIComponent(url)}`)
}

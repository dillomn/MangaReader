/**
 * Gold Split — a webcomic by greasequeen (greasequeen.com), scraped with
 * the author's permission via the local proxy's /goldsplit routes.
 *
 * Unlike MangaDex/Mangapill manga, Gold Split is a single known series with
 * a fixed manga id ("goldsplit") and chapter ids of the form
 * "goldsplit:/YYYY/MM/DD/gold-split-chapter-N/".
 */
import type { Manga, Chapter } from '../types'

const BASE = '/goldsplit'

export const GOLD_SPLIT_ID = 'goldsplit'

export function isGoldSplitManga(id: string | undefined): boolean {
  return id === GOLD_SPLIT_ID
}

export function isGoldSplitChapter(chapterId: string | undefined): boolean {
  return !!chapterId?.startsWith('goldsplit:')
}

interface GQSeries {
  title: string
  coverUrl: string
  synopsis: string
  chapters: { path: string; number: number }[]
}

// The series rarely changes; share one in-flight/settled fetch per session
let seriesPromise: Promise<GQSeries> | null = null

function fetchSeries(): Promise<GQSeries> {
  if (!seriesPromise) {
    seriesPromise = fetch(`${BASE}/series`).then((res) => {
      if (!res.ok) throw new Error(`Gold Split proxy ${res.status}: /series`)
      return res.json() as Promise<GQSeries>
    })
    seriesPromise.catch(() => { seriesPromise = null })
  }
  return seriesPromise
}

// Route images through the proxy so blob fetches (offline downloads) aren't
// blocked by CORS and the CDN sees a same-site Referer.
function proxiedImage(url: string): string {
  return `${BASE}/img?url=${encodeURIComponent(url)}`
}

export async function getGoldSplitManga(): Promise<Manga> {
  const s = await fetchSeries()
  return {
    id: GOLD_SPLIT_ID,
    title: s.title,
    author: 'greasequeen',
    artist: 'greasequeen',
    coverUrl: s.coverUrl ? proxiedImage(s.coverUrl) : '',
    synopsis: s.synopsis,
    genres: ['Webcomic'],
    status: 'Ongoing',
  }
}

export async function getGoldSplitChapters(): Promise<Chapter[]> {
  const s = await fetchSeries()
  return s.chapters
    .map((ch): Chapter => ({
      id: `goldsplit:${ch.path}`,
      number: ch.number,
      title: `Chapter ${ch.number}`,
      // Post path starts with the publish date: /YYYY/MM/DD/...
      uploadedAt: ch.path.slice(1, 11).replace(/\//g, '-'),
      pages: 0,
      source: 'goldsplit',
    }))
    .sort((a, b) => a.number - b.number)
}

export async function getGoldSplitChapterPages(chapterPath: string): Promise<string[]> {
  const res = await fetch(`${BASE}/pages?path=${encodeURIComponent(chapterPath)}`)
  if (!res.ok) throw new Error(`Gold Split proxy ${res.status}: /pages`)
  const urls = (await res.json()) as string[]
  return urls.map(proxiedImage)
}

import type { Manga, Chapter } from '../types'
import { authFetch } from '../utils/api'

const BASE = '/mangadex-api'
// Include erotica so mainstream mature manga (Berserk, etc.) appear in search.
const CONTENT_RATING = ['safe', 'suggestive', 'erotica']
const ALL_CONTENT_RATINGS = ['safe', 'suggestive', 'erotica', 'pornographic']

// Format tag IDs to exclude from search results
const EXCLUDED_TAGS = [
  'b13b2a48-c720-44a9-9c77-39c9979373fb', // Doujinshi
  '891cf039-b895-47f0-9229-bef4c96eccd4', // Self-Published
]

// ---- Raw API shapes ----

interface MDRelationship {
  id: string
  type: string
  attributes?: {
    fileName?: string
    name?: string
  }
}

interface MDTag {
  id: string
  attributes: {
    name: { en?: string }
    group: string
  }
}

interface MDManga {
  id: string
  attributes: {
    title: Record<string, string>
    altTitles: Array<Record<string, string>>
    description: Record<string, string>
    status: string
    tags: MDTag[]
    lastChapter: string | null
    year: number | null
  }
  relationships: MDRelationship[]
}

interface MDChapter {
  id: string
  attributes: {
    chapter: string | null
    title: string | null
    volume: string | null
    pages: number
    publishAt: string
    translatedLanguage: string
  }
  relationships: MDRelationship[]
}

interface MDList<T> {
  data: T[]
  total: number
}

interface MDEntity<T> {
  data: T
}

interface MDAtHome {
  baseUrl: string
  chapter: {
    hash: string
    data: string[]
    dataSaver: string[]
  }
}

// ---- Helpers ----

const STATUS_MAP: Record<string, Manga['status']> = {
  ongoing: 'Ongoing',
  completed: 'Completed',
  hiatus: 'Hiatus',
  cancelled: 'Hiatus',
}

function coverUrl(mangaId: string, rels: MDRelationship[]): string {
  const cover = rels.find((r) => r.type === 'cover_art')
  if (!cover?.attributes?.fileName) return ''
  return `/mangadex-covers/covers/${mangaId}/${cover.attributes.fileName}.512.jpg`
}

function relName(rels: MDRelationship[], type: string): string {
  return rels.find((r) => r.type === type)?.attributes?.name ?? 'Unknown'
}

function mapManga(md: MDManga): Manga {
  const title =
    md.attributes.title['en'] ??
    md.attributes.altTitles?.find((t) => 'en' in t)?.['en'] ??
    Object.values(md.attributes.title)[0] ??
    'Unknown'
  return {
    id: md.id,
    title,
    author: relName(md.relationships, 'author'),
    artist: relName(md.relationships, 'artist'),
    coverUrl: coverUrl(md.id, md.relationships),
    synopsis: md.attributes.description['en'] ?? '',
    genres: md.attributes.tags
      .filter((t) => t.attributes.group === 'genre')
      .map((t) => t.attributes.name.en ?? '')
      .filter(Boolean),
    status: STATUS_MAP[md.attributes.status] ?? 'Ongoing',
    lastChapter: md.attributes.lastChapter ?? undefined,
    year: md.attributes.year ?? undefined,
  }
}

function mapChapter(md: MDChapter): Chapter {
  const group = md.relationships.find((r) => r.type === 'scanlation_group')
  return {
    id: md.id,
    number: parseFloat(md.attributes.chapter ?? '0'),
    title: md.attributes.title ?? `Chapter ${md.attributes.chapter ?? '?'}`,
    volume: md.attributes.volume ?? undefined,
    uploadedAt: md.attributes.publishAt.split('T')[0],
    pages: md.attributes.pages,
    scanlationGroup: group?.attributes?.name,
  }
}

async function apiFetch<T>(
  path: string,
  params: Record<string, string | string[]> = {},
): Promise<T> {
  const url = new URL(`${BASE}${path}`, location.origin)
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach((v) => url.searchParams.append(key, v))
    } else {
      url.searchParams.set(key, value)
    }
  }
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`MangaDex ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

// ---- Public API ----

export type BrowseSort = 'popular' | 'latest' | 'new'

const BROWSE_ORDER: Record<BrowseSort, Record<string, string>> = {
  popular: { 'order[followedCount]': 'desc' },
  latest:  { 'order[latestUploadedChapter]': 'desc' },
  new:     { 'order[createdAt]': 'desc' },
}

export interface MangaTag {
  id: string
  name: string
  group: string
}

const BLOCKED_TAGS = new Set(['Loli', 'Shota', 'Incest', 'Sexual Violence'])

export async function getTags(): Promise<MangaTag[]> {
  const data = await apiFetch<MDList<MDTag>>('/manga/tag')
  return data.data
    .map(t => ({ id: t.id, name: t.attributes.name.en ?? '', group: t.attributes.group }))
    .filter(t => t.name && (t.group === 'genre' || t.group === 'theme') && !BLOCKED_TAGS.has(t.name))
    .sort((a, b) => {
      if (a.group !== b.group) return a.group === 'genre' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export async function searchManga(
  query: string,
  offset = 0,
  sort: BrowseSort = 'popular',
  includedTags: string[] = [],
): Promise<{ manga: Manga[]; total: number }> {
  const hasQuery = query.trim().length > 0
  const params: Record<string, string | string[]> = {
    limit: '20',
    offset: String(offset),
    ...(hasQuery ? { 'order[relevance]': 'desc' } : BROWSE_ORDER[sort]),
    'contentRating[]': CONTENT_RATING,
    'includes[]': ['cover_art', 'author', 'artist'],
    hasAvailableChapters: 'true',
    'excludedTags[]': EXCLUDED_TAGS,
  }
  if (hasQuery) params['title'] = query.trim()
  if (includedTags.length > 0) params['includedTags[]'] = includedTags

  const data = await apiFetch<MDList<MDManga>>('/manga', params)
  return { manga: data.data.map(mapManga), total: data.total }
}

export async function getRandomManga(): Promise<Manga> {
  const data = await apiFetch<MDEntity<MDManga>>('/manga/random', {
    'contentRating[]': CONTENT_RATING,
    'includes[]': ['cover_art', 'author', 'artist'],
  })
  return mapManga(data.data)
}

export async function getManga(id: string): Promise<Manga> {
  const data = await apiFetch<MDEntity<MDManga>>(`/manga/${id}`, {
    'includes[]': ['cover_art', 'author', 'artist'],
  })
  return mapManga(data.data)
}

export async function getChapters(mangaId: string): Promise<Chapter[]> {
  const LIMIT = 500
  const feedParams = {
    limit: String(LIMIT),
    'translatedLanguage[]': ['en'],
    'order[chapter]': 'asc',
    'contentRating[]': ALL_CONTENT_RATINGS,
    'includes[]': ['scanlation_group'],
  }

  const first = await apiFetch<MDList<MDChapter>>(`/manga/${mangaId}/feed`, {
    ...feedParams,
    offset: '0',
  })

  const allRaw: MDChapter[] = [...first.data]

  // Popular manga can have thousands of feed entries (multiple scanlators × chapters)
  if (first.total > LIMIT) {
    const pages = Math.ceil((first.total - LIMIT) / LIMIT)
    for (let i = 1; i <= pages; i++) {
      const page = await apiFetch<MDList<MDChapter>>(`/manga/${mangaId}/feed`, {
        ...feedParams,
        offset: String(i * LIMIT),
      })
      allRaw.push(...page.data)
    }
  }

  // Deduplicate by chapter number, keeping the first scanlation encountered.
  // Chapters with pages=0 are externally hosted — included so list is complete;
  // Reader handles the no-pages case gracefully.
  const seen = new Set<number>()
  return allRaw
    .map(mapChapter)
    .filter((ch) => {
      if (seen.has(ch.number)) return false
      seen.add(ch.number)
      return true
    })
    .sort((a, b) => a.number - b.number)
}

export async function getChapterPages(chapterId: string, forceRefresh = false): Promise<string[]> {
  const url = new URL(`${BASE}/at-home/server/${chapterId}`, location.origin)
  // forcePort443 requests a node on the standard HTTPS port — a different pool,
  // increasing the chance of getting a healthy node on retry.
  if (forceRefresh) url.searchParams.set('forcePort443', 'true')
  const res = await fetch(url.toString(), forceRefresh ? { cache: 'no-store' } : {})
  if (!res.ok) throw new Error(`MangaDex ${res.status}: at-home server`)
  const data: MDAtHome = await res.json()
  const base = data.baseUrl.replace(/^http:\/\//, 'https://')
  return data.chapter.data.map(
    (filename) => `${base}/data/${data.chapter.hash}/${filename}`,
  )
}

/**
 * Report a page load result to MangaDex's at-home network.
 * Routed through our proxy to avoid browser CORS restrictions.
 * Without failure reports, MangaDex cannot know a CDN node is down
 * and will keep assigning the same broken node to users.
 */
export function reportAtHomeResult(url: string, success: boolean, duration: number, bytes: number): void {
  authFetch('/api/at-home/report', {
    method: 'POST',
    body: JSON.stringify({ url, success, bytes, duration, cached: false }),
  }).catch(() => {})
}

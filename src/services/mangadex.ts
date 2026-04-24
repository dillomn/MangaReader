import type { Manga, Chapter } from '../types'

const BASE = 'https://api.mangadex.org'
// Include erotica so mainstream mature manga (Berserk, etc.) appear in search.
// Pornographic content is still excluded by default.
const CONTENT_RATING = ['safe', 'suggestive', 'erotica']
const ALL_CONTENT_RATINGS = ['safe', 'suggestive', 'erotica', 'pornographic']

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
    description: Record<string, string>
    status: string
    tags: MDTag[]
    type: string
  }
  relationships: MDRelationship[]
}

interface MDChapter {
  id: string
  attributes: {
    chapter: string | null
    title: string | null
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
  return `https://uploads.mangadex.org/covers/${mangaId}/${cover.attributes.fileName}.512.jpg`
}

function relName(rels: MDRelationship[], type: string): string {
  return rels.find((r) => r.type === type)?.attributes?.name ?? 'Unknown'
}

function mapManga(md: MDManga): Manga {
  const title = md.attributes.title['en'] ?? Object.values(md.attributes.title)[0] ?? 'Unknown'
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
    chapters: [],
  }
}

function mapChapter(md: MDChapter): Chapter {
  const group = md.relationships.find((r) => r.type === 'scanlation_group')
  return {
    id: md.id,
    number: parseFloat(md.attributes.chapter ?? '0'),
    title: md.attributes.title ?? `Chapter ${md.attributes.chapter ?? '?'}`,
    uploadedAt: md.attributes.publishAt.split('T')[0],
    pages: md.attributes.pages,
    scanlationGroup: group?.attributes?.name,
  }
}

async function apiFetch<T>(
  path: string,
  params: Record<string, string | string[]> = {},
): Promise<T> {
  const url = new URL(`${BASE}${path}`)
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

export async function searchManga(
  query: string,
  offset = 0,
): Promise<{ manga: Manga[]; total: number }> {
  const params: Record<string, string | string[]> = {
    limit: '20',
    offset: String(offset),
    'order[latestUploadedChapter]': 'desc',
    'contentRating[]': CONTENT_RATING,
    'includes[]': ['cover_art', 'author', 'artist'],
  }
  if (query.trim()) params['title'] = query.trim()

  const data = await apiFetch<MDList<MDManga>>('/manga', params)
  const official = data.data.filter((md) => md.attributes.type !== 'doujinshi')
  return { manga: official.map(mapManga), total: data.total }
}

export async function getManga(id: string): Promise<Manga> {
  const data = await apiFetch<MDEntity<MDManga>>(`/manga/${id}`, {
    'includes[]': ['cover_art', 'author', 'artist'],
  })
  return mapManga(data.data)
}

export async function getChapters(mangaId: string): Promise<Chapter[]> {
  // Fetch up to 500 chapters; handles most manga. Long-running series may need pagination.
  const data = await apiFetch<MDList<MDChapter>>(`/manga/${mangaId}/feed`, {
    limit: '500',
    'translatedLanguage[]': ['en'],
    'order[chapter]': 'asc',
    'contentRating[]': ALL_CONTENT_RATINGS,
    'includes[]': ['scanlation_group'],
  })

  // Deduplicate by chapter number, keeping the first scanlation encountered.
  // Note: some chapters have pages=0 (externally-hosted) — still include them so the
  // chapter list is complete; Reader handles the no-pages case gracefully.
  const seen = new Set<number>()
  return data.data
    .map(mapChapter)
    .filter((ch) => {
      if (seen.has(ch.number)) return false
      seen.add(ch.number)
      return true
    })
}

export async function getChapterPages(chapterId: string): Promise<string[]> {
  const data = await apiFetch<MDAtHome>(`/at-home/server/${chapterId}`)
  return data.chapter.data.map(
    (filename) => `${data.baseUrl}/data/${data.chapter.hash}/${filename}`,
  )
}

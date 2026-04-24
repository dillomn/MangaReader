export interface Chapter {
  id: string
  number: number
  title: string
  uploadedAt: string
  pages: number
  scanlationGroup?: string
}

export interface Manga {
  id: string
  title: string
  author: string
  artist: string
  coverUrl: string
  synopsis: string
  genres: string[]
  status: 'Ongoing' | 'Completed' | 'Hiatus'
  chapters: Chapter[]
}

export type DownloadStatus = 'idle' | 'downloading' | 'downloaded' | 'error'

export interface DownloadInfo {
  status: DownloadStatus
  progress: number
  totalPages: number
  downloadedPages: number
  mangaId?: string
  mangaTitle?: string
  coverUrl?: string
  chapterNumber?: number
  chapterTitle?: string
}

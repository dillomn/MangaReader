export interface Chapter {
  id: string
  number: number
  title: string
  volume?: string
  uploadedAt: string
  pages: number
  scanlationGroup?: string
  source?: 'mangapill' | 'comick'
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
  lastChapter?: string
  year?: number
}

export interface ReadProgress {
  mangaId: string
  lastPage: number
  totalPages: number
  completed: boolean
  updatedAt: string
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

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { DownloadInfo } from '../types'
import * as storage from '../services/storage'
import * as mangadex from '../services/mangadex'

export interface ChapterMeta {
  mangaId: string
  mangaTitle: string
  coverUrl: string
  chapterNumber: number
  chapterTitle: string
}

interface DownloadContextValue {
  statuses: Record<string, DownloadInfo>
  downloadChapter: (chapterId: string, meta?: ChapterMeta) => Promise<void>
  deleteChapter: (chapterId: string) => Promise<void>
}

const DownloadContext = createContext<DownloadContextValue | null>(null)

export function DownloadProvider({ children }: { children: ReactNode }) {
  const [statuses, setStatuses] = useState<Record<string, DownloadInfo>>({})
  const activeDownloads = useRef<Set<string>>(new Set())

  useEffect(() => {
    storage.getAllDownloadInfos().then(setStatuses)
  }, [])

  function updateStatus(chapterId: string, info: DownloadInfo) {
    setStatuses((prev) => ({ ...prev, [chapterId]: info }))
    storage.setDownloadInfo(chapterId, info)
  }

  async function downloadChapter(chapterId: string, meta?: ChapterMeta) {
    if (activeDownloads.current.has(chapterId)) return
    activeDownloads.current.add(chapterId)

    updateStatus(chapterId, {
      status: 'downloading',
      progress: 0,
      totalPages: 0,
      downloadedPages: 0,
      ...meta,
    })

    try {
      const pageUrls = await mangadex.getChapterPages(chapterId)
      const total = pageUrls.length
      if (total === 0) throw new Error('No pages hosted on MangaDex for this chapter')

      for (let i = 0; i < total; i++) {
        const res = await fetch(pageUrls[i])
        if (!res.ok) throw new Error(`Page ${i + 1} fetch failed: ${res.status}`)
        const blob = await res.blob()
        await storage.savePage(chapterId, i, blob)
        updateStatus(chapterId, {
          status: 'downloading',
          progress: Math.round(((i + 1) / total) * 100),
          totalPages: total,
          downloadedPages: i + 1,
          ...meta,
        })
      }

      updateStatus(chapterId, {
        status: 'downloaded',
        progress: 100,
        totalPages: total,
        downloadedPages: total,
        ...meta,
      })
    } catch {
      const existing = statuses[chapterId]
      updateStatus(chapterId, {
        status: 'error',
        progress: 0,
        totalPages: existing?.totalPages ?? 0,
        downloadedPages: 0,
      })
    } finally {
      activeDownloads.current.delete(chapterId)
    }
  }

  async function deleteChapter(chapterId: string) {
    const info = statuses[chapterId]
    if (!info) return
    await storage.deleteChapter(chapterId, info.totalPages)
    setStatuses((prev) => {
      const next = { ...prev }
      delete next[chapterId]
      return next
    })
  }

  return (
    <DownloadContext.Provider value={{ statuses, downloadChapter, deleteChapter }}>
      {children}
    </DownloadContext.Provider>
  )
}

export function useDownloads() {
  const ctx = useContext(DownloadContext)
  if (!ctx) throw new Error('useDownloads must be used within DownloadProvider')
  return ctx
}

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
import { getMangapillChapterPages } from '../services/mangapill'

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
  cancelDownload: (chapterId: string) => void
}

const DownloadContext = createContext<DownloadContextValue | null>(null)

export function DownloadProvider({ children }: { children: ReactNode }) {
  const [statuses, setStatuses] = useState<Record<string, DownloadInfo>>({})
  const activeDownloads = useRef<Set<string>>(new Set())
  const abortControllers = useRef<Map<string, AbortController>>(new Map())

  useEffect(() => {
    storage.getAllDownloadInfos().then(infos => {
      // Any status still 'downloading' means the app was closed mid-download — mark as error
      const fixed: Record<string, DownloadInfo> = {}
      for (const [id, info] of Object.entries(infos)) {
        fixed[id] = info.status === 'downloading' ? { ...info, status: 'error' } : info
        if (info.status === 'downloading') storage.setDownloadInfo(id, { ...info, status: 'error' })
      }
      setStatuses(fixed)
    })
  }, [])

  function updateStatus(chapterId: string, info: DownloadInfo) {
    setStatuses((prev) => ({ ...prev, [chapterId]: info }))
    storage.setDownloadInfo(chapterId, info)
  }

  async function downloadChapter(chapterId: string, meta?: ChapterMeta) {
    if (activeDownloads.current.has(chapterId)) return
    activeDownloads.current.add(chapterId)

    const controller = new AbortController()
    abortControllers.current.set(chapterId, controller)

    updateStatus(chapterId, {
      status: 'downloading',
      progress: 0,
      totalPages: 0,
      downloadedPages: 0,
      ...meta,
    })

    let total = 0
    let savedCount = 0

    try {
      const pageUrls = chapterId.startsWith('mangapill:')
        ? await getMangapillChapterPages(chapterId.slice('mangapill:'.length))
        : await mangadex.getChapterPages(chapterId)
      total = pageUrls.length
      if (total === 0) throw new Error('No pages found for this chapter')

      for (let i = 0; i < total; i++) {
        if (controller.signal.aborted) break
        const res = await fetch(pageUrls[i], { signal: controller.signal })
        if (!res.ok) throw new Error(`Page ${i + 1} fetch failed: ${res.status}`)
        const blob = await res.blob()
        await storage.savePage(chapterId, i, blob)
        savedCount = i + 1
        updateStatus(chapterId, {
          status: 'downloading',
          progress: Math.round(((i + 1) / total) * 100),
          totalPages: total,
          downloadedPages: i + 1,
          ...meta,
        })
      }

      if (controller.signal.aborted) {
        await storage.deleteChapter(chapterId, savedCount)
        setStatuses((prev) => { const next = { ...prev }; delete next[chapterId]; return next })
        return
      }

      updateStatus(chapterId, {
        status: 'downloaded',
        progress: 100,
        totalPages: total,
        downloadedPages: total,
        ...meta,
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        await storage.deleteChapter(chapterId, savedCount)
        setStatuses((prev) => { const next = { ...prev }; delete next[chapterId]; return next })
      } else {
        const existing = statuses[chapterId]
        updateStatus(chapterId, {
          status: 'error',
          progress: 0,
          totalPages: existing?.totalPages ?? 0,
          downloadedPages: 0,
        })
      }
    } finally {
      activeDownloads.current.delete(chapterId)
      abortControllers.current.delete(chapterId)
    }
  }

  function cancelDownload(chapterId: string) {
    abortControllers.current.get(chapterId)?.abort()
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
    <DownloadContext.Provider value={{ statuses, downloadChapter, deleteChapter, cancelDownload }}>
      {children}
    </DownloadContext.Provider>
  )
}

export function useDownloads() {
  const ctx = useContext(DownloadContext)
  if (!ctx) throw new Error('useDownloads must be used within DownloadProvider')
  return ctx
}

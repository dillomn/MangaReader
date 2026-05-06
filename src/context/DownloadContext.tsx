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
import { authFetch, getToken } from '../utils/api'

// MangaDex at-home API: 40 requests per 60-second window. Space download calls
// to ≤35/min so bulk "Download All" never exhausts the limit.
let lastAtHomeCallMs = 0
const AT_HOME_MIN_INTERVAL_MS = 1700

async function getChapterPagesThrottled(chapterId: string): Promise<string[]> {
  const gap = AT_HOME_MIN_INTERVAL_MS - (Date.now() - lastAtHomeCallMs)
  if (gap > 0) await new Promise<void>(r => setTimeout(r, gap))
  lastAtHomeCallMs = Date.now()
  return mangadex.getChapterPages(chapterId)
}

export interface ChapterMeta {
  mangaId: string
  mangaTitle: string
  coverUrl: string
  chapterNumber: number
  chapterTitle: string
}

interface DownloadContextValue {
  statuses: Record<string, DownloadInfo>
  syncReady: boolean
  downloadChapter: (chapterId: string, meta?: ChapterMeta) => Promise<void>
  deleteChapter: (chapterId: string) => Promise<void>
  cancelDownload: (chapterId: string) => void
}

const DownloadContext = createContext<DownloadContextValue | null>(null)

export function DownloadProvider({ children }: { children: ReactNode }) {
  const [statuses, setStatuses] = useState<Record<string, DownloadInfo>>({})
  const [syncReady, setSyncReady] = useState(false)
  const activeDownloads = useRef<Set<string>>(new Set())
  const abortControllers = useRef<Map<string, AbortController>>(new Map())

  useEffect(() => {
    storage.getAllDownloadInfos().then(async (infos) => {
      const fixed: Record<string, DownloadInfo> = {}
      for (const [id, info] of Object.entries(infos)) {
        fixed[id] = info.status === 'downloading' ? { ...info, status: 'error' } : info
        if (info.status === 'downloading') storage.setDownloadInfo(id, { ...info, status: 'error' })
      }

      // Apply admin-scheduled removals BEFORE setting statuses so the Library
      // never renders with a chapter that should already be gone.
      if (getToken()) {
        try {
          const syncRes = await authFetch('/api/sync')
          if (!syncRes.ok) {
            console.warn('[sync] /api/sync returned', syncRes.status, '— proxy may need restarting')
          } else {
            const { remove } = await syncRes.json() as { remove: string[] }
            if (remove?.length) {
              console.log('[sync] admin-scheduled removals:', remove)
              for (const chapterId of remove) {
                await storage.deleteChapter(chapterId, fixed[chapterId]?.totalPages ?? 0)
                delete fixed[chapterId]
              }
              await authFetch('/api/sync/ack', {
                method: 'POST',
                body: JSON.stringify({ chapterIds: remove }),
              })
              console.log('[sync] removals applied and acknowledged')
            }
          }
        } catch (err) {
          console.warn('[sync] failed:', err)
        }
      }

      setStatuses(fixed)
      setSyncReady(true)
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
        : await getChapterPagesThrottled(chapterId)
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

      if (meta) {
        authFetch('/api/activity/download', {
          method: 'POST',
          body: JSON.stringify({ chapterId, ...meta }),
        }).catch(() => {})
      }
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
    <DownloadContext.Provider value={{ statuses, syncReady, downloadChapter, deleteChapter, cancelDownload }}>
      {children}
    </DownloadContext.Provider>
  )
}

export function useDownloads() {
  const ctx = useContext(DownloadContext)
  if (!ctx) throw new Error('useDownloads must be used within DownloadProvider')
  return ctx
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { ReadProgress } from '../types'
import { authFetch, getToken } from '../utils/api'

interface ReadProgressContextValue {
  readStatuses: Record<string, ReadProgress>
  updateProgress: (chapterId: string, mangaId: string, lastPage: number, totalPages: number) => void
  markUnread: (chapterId: string) => void
  markAllUnread: (mangaId: string) => void
}

const ReadProgressContext = createContext<ReadProgressContextValue | null>(null)

const STORAGE_KEY = 'reading-progress'

function load(): Record<string, ReadProgress> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function persist(data: Record<string, ReadProgress>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function ReadProgressProvider({ children }: { children: ReactNode }) {
  const [readStatuses, setReadStatuses] = useState<Record<string, ReadProgress>>(load)
  // Always-current ref so debounced server syncs read the latest state.
  const readStatusesRef = useRef<Record<string, ReadProgress>>({})
  readStatusesRef.current = readStatuses
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // On mount: fetch server progress and merge (newest updatedAt wins).
  useEffect(() => {
    if (!getToken()) return
    authFetch('/api/progress')
      .then(res => res.ok ? res.json() : null)
      .then((data: { progress: Record<string, ReadProgress> } | null) => {
        if (!data?.progress) return
        setReadStatuses(prev => {
          const merged = { ...prev }
          for (const [chapterId, serverEntry] of Object.entries(data.progress)) {
            const local = prev[chapterId]
            if (!local || new Date(serverEntry.updatedAt) > new Date(local.updatedAt)) {
              merged[chapterId] = serverEntry
            }
          }
          persist(merged)
          return merged
        })
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateProgress = useCallback((
    chapterId: string,
    mangaId: string,
    lastPage: number,
    totalPages: number,
  ) => {
    setReadStatuses((prev) => {
      const existing = prev[chapterId]
      const completed = totalPages > 0 && lastPage >= totalPages - 1
      // Don't downgrade a completed chapter back to in-progress
      if (existing?.completed && !completed) return prev
      // Don't write a redundant update
      if (existing?.lastPage === lastPage && existing?.completed === completed) return prev
      const next = {
        ...prev,
        [chapterId]: { mangaId, lastPage, totalPages, completed, updatedAt: new Date().toISOString() },
      }
      persist(next)
      return next
    })

    // Debounce server sync by 2s so rapid page-turns don't hammer the API.
    if (syncTimerRef.current !== null) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null
      const entry = readStatusesRef.current[chapterId]
      if (entry && getToken()) {
        authFetch('/api/progress', {
          method: 'POST',
          body: JSON.stringify({ chapterId, ...entry }),
        }).catch(() => {})
      }
    }, 2000)
  }, [])

  const markUnread = useCallback((chapterId: string) => {
    setReadStatuses((prev) => {
      const next = { ...prev }
      delete next[chapterId]
      persist(next)
      return next
    })
    if (getToken()) {
      authFetch('/api/progress', {
        method: 'DELETE',
        body: JSON.stringify({ chapterId }),
      }).catch(() => {})
    }
  }, [])

  const markAllUnread = useCallback((mangaId: string) => {
    setReadStatuses((prev) => {
      const next: Record<string, ReadProgress> = {}
      for (const [id, prog] of Object.entries(prev)) {
        if (prog.mangaId !== mangaId) next[id] = prog
      }
      persist(next)
      return next
    })
    if (getToken()) {
      authFetch('/api/progress', {
        method: 'DELETE',
        body: JSON.stringify({ mangaId }),
      }).catch(() => {})
    }
  }, [])

  const value = useMemo(
    () => ({ readStatuses, updateProgress, markUnread, markAllUnread }),
    [readStatuses, updateProgress, markUnread, markAllUnread],
  )

  return (
    <ReadProgressContext.Provider value={value}>
      {children}
    </ReadProgressContext.Provider>
  )
}

export function useReadProgress() {
  const ctx = useContext(ReadProgressContext)
  if (!ctx) throw new Error('useReadProgress must be used within ReadProgressProvider')
  return ctx
}

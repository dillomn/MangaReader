import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { ReadProgress } from '../types'

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
  }, [])

  const markUnread = useCallback((chapterId: string) => {
    setReadStatuses((prev) => {
      const next = { ...prev }
      delete next[chapterId]
      persist(next)
      return next
    })
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

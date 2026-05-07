import { createContext, useContext, useEffect, useState } from 'react'
import {
  fetchLibrary,
  saveBookmark as apiSave,
  removeBookmark as apiRemove,
  type Bookmark,
} from '../services/bookmarks'

interface LibraryCtx {
  bookmarks: Record<string, Bookmark>
  loading: boolean
  saveBookmark: (mangaId: string, mangaTitle: string, coverUrl: string) => Promise<void>
  removeBookmark: (mangaId: string) => Promise<void>
}

const LibraryContext = createContext<LibraryCtx>({
  bookmarks: {},
  loading: true,
  saveBookmark: async () => {},
  removeBookmark: async () => {},
})

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [bookmarks, setBookmarks] = useState<Record<string, Bookmark>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLibrary()
      .then(setBookmarks)
      .finally(() => setLoading(false))
  }, [])

  async function saveBookmark(mangaId: string, mangaTitle: string, coverUrl: string) {
    await apiSave(mangaId, mangaTitle, coverUrl)
    setBookmarks(prev => ({
      ...prev,
      [mangaId]: { mangaId, mangaTitle, coverUrl, savedAt: new Date().toISOString() },
    }))
  }

  async function removeBookmark(mangaId: string) {
    await apiRemove(mangaId)
    setBookmarks(prev => {
      const next = { ...prev }
      delete next[mangaId]
      return next
    })
  }

  return (
    <LibraryContext.Provider value={{ bookmarks, loading, saveBookmark, removeBookmark }}>
      {children}
    </LibraryContext.Provider>
  )
}

export function useLibrary() {
  return useContext(LibraryContext)
}

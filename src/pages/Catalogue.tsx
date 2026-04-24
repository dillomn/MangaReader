import { useState, useEffect, useRef } from 'react'
import { searchManga } from '../services/mangadex'
import type { Manga } from '../types'
import MangaCard from '../components/MangaCard/MangaCard'
import styles from './Catalogue.module.css'

export default function Catalogue() {
  const [manga, setManga] = useState<Manga[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setLoading(true)
    setError(null)
    setOffset(0)

    debounceRef.current = setTimeout(async () => {
      try {
        const result = await searchManga(search)
        setManga(result.manga)
        setTotal(result.total)
      } catch {
        setError('Failed to load manga. Check your connection and try again.')
      } finally {
        setLoading(false)
      }
    }, 400)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const nextOffset = offset + 20
      const result = await searchManga(search, nextOffset)
      setManga((prev) => [...prev, ...result.manga])
      setOffset(nextOffset)
    } catch {
      // silently ignore — user can retry
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.heading}>Catalogue</h1>
        <input
          className={styles.search}
          type="search"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {loading ? (
        <div className={styles.grid}>
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      ) : manga.length === 0 ? (
        <div className={styles.empty}>
          <p>No manga found for &ldquo;{search}&rdquo;.</p>
          <p className={styles.emptyHint}>
            MangaDex hosts 70k+ titles — try a different spelling or English title.
          </p>
        </div>
      ) : (
        <>
          <div className={styles.grid}>
            {manga.map((m) => (
              <MangaCard key={m.id} manga={m} />
            ))}
          </div>
          {manga.length < total && (
            <div className={styles.loadMoreRow}>
              <button
                className={styles.loadMoreBtn}
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading…' : `Load more (${total - manga.length} remaining)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

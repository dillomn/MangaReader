import { useState, useEffect } from 'react'
import { getTags, searchManga } from '../services/mangadex'
import type { MangaTag } from '../services/mangadex'
import type { Manga } from '../types'
import MangaCard from '../components/MangaCard/MangaCard'
import styles from './Explore.module.css'

export default function Explore() {
  const [tags, setTags] = useState<MangaTag[]>([])
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [manga, setManga] = useState<Manga[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [tagsLoading, setTagsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getTags()
      .then(setTags)
      .catch(() => {})
      .finally(() => setTagsLoading(false))
  }, [])

  useEffect(() => {
    if (selectedTags.size === 0) {
      setManga([])
      setTotal(0)
      setOffset(0)
      return
    }
    setLoading(true)
    setError(null)
    setOffset(0)
    searchManga('', 0, 'popular', Array.from(selectedTags))
      .then((result) => {
        setManga(result.manga)
        setTotal(result.total)
      })
      .catch(() => setError('Failed to load results.'))
      .finally(() => setLoading(false))
  }, [selectedTags])

  function toggleTag(id: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function loadMore() {
    setLoadingMore(true)
    const nextOffset = offset + 20
    try {
      const result = await searchManga('', nextOffset, 'popular', Array.from(selectedTags))
      setManga((prev) => [...prev, ...result.manga])
      setOffset(nextOffset)
    } catch {}
    finally {
      setLoadingMore(false)
    }
  }

  const genres = tags.filter((t) => t.group === 'genre')
  const themes = tags.filter((t) => t.group === 'theme')

  return (
    <div>
      <h1 className={styles.heading}>Explore</h1>
      <p className={styles.subheading}>Pick one or more tags to find popular manga.</p>

      {tagsLoading ? (
        <div className={styles.tagAreaSkeleton}>
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className={styles.tagSkeleton} style={{ width: `${55 + (i % 5) * 18}px` }} />
          ))}
        </div>
      ) : (
        <div className={styles.tagArea}>
          {genres.length > 0 && (
            <section className={styles.tagGroup}>
              <h2 className={styles.groupLabel}>Genre</h2>
              <div className={styles.tagRow}>
                {genres.map((tag) => (
                  <button
                    key={tag.id}
                    className={`${styles.tag} ${selectedTags.has(tag.id) ? styles.tagActive : ''}`}
                    onClick={() => toggleTag(tag.id)}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </section>
          )}
          {themes.length > 0 && (
            <section className={styles.tagGroup}>
              <h2 className={styles.groupLabel}>Theme</h2>
              <div className={styles.tagRow}>
                {themes.map((tag) => (
                  <button
                    key={tag.id}
                    className={`${styles.tag} ${selectedTags.has(tag.id) ? styles.tagActive : ''}`}
                    onClick={() => toggleTag(tag.id)}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {selectedTags.size > 0 && (
        <section className={styles.results}>
          <h2 className={styles.resultsHeading}>
            Results
            {!loading && <span className={styles.resultsCount}>{total.toLocaleString()}</span>}
          </h2>

          {error && <p className={styles.error}>{error}</p>}

          {loading ? (
            <div className={styles.grid}>
              {Array.from({ length: 20 }).map((_, i) => (
                <div key={i} className={styles.skeleton} />
              ))}
            </div>
          ) : manga.length === 0 ? (
            <p className={styles.empty}>No manga found with the selected tags.</p>
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
                    {loadingMore ? 'Loading…' : `Load more (${(total - manga.length).toLocaleString()} remaining)`}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {selectedTags.size === 0 && !tagsLoading && (
        <p className={styles.hint}>Select tags above to browse manga.</p>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { getManga, getChapters } from '../services/mangadex'
import { findMangapillManga, getMangapillChapters } from '../services/mangapill'
import { useDownloads } from '../context/DownloadContext'
import { useReadProgress } from '../context/ReadProgressContext'
import DownloadButton from '../components/DownloadButton/DownloadButton'
import type { Manga, Chapter } from '../types'
import styles from './MangaDetail.module.css'

type SourcePref = 'auto' | 'mangadex' | 'mangapill'

const STATUS_COLORS: Record<string, string> = {
  Ongoing: '#2ecc71',
  Completed: '#3498db',
  Hiatus: '#f39c12',
}

export default function MangaDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { statuses, downloadChapter } = useDownloads()
  const { readStatuses, markUnread, markAllUnread } = useReadProgress()

  const [manga, setManga] = useState<Manga | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)
  const [chaptersLoading, setChaptersLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [savingAll, setSavingAll] = useState(false)
  const [saveAllProgress, setSaveAllProgress] = useState({ done: 0, total: 0 })
  const [pdfGenerating, setPdfGenerating] = useState<string | null>(null)
  const [pdfAllProgress, setPdfAllProgress] = useState<{ done: number; total: number } | null>(null)
  // sourcePref exists only to re-trigger the chapter effect when user explicitly picks a source.
  // The effect always reads the effective preference fresh from localStorage to avoid stale closures.
  const [sourcePref, setSourcePref] = useState<SourcePref>('auto')
  const [activeSource, setActiveSource] = useState<'mangadex' | 'mangapill'>('mangadex')
  // undefined = unchecked, 0 = no chapters, N = chapter count
  const [sourceCounts, setSourceCounts] = useState<Partial<Record<'mangadex' | 'mangapill', number>>>({})

  // Load manga metadata
  useEffect(() => {
    if (!id) return
    setLoading(true)
    setError(null)
    getManga(id)
      .then(setManga)
      .catch(() => setError('Failed to load manga.'))
      .finally(() => setLoading(false))
  }, [id])

  // Load chapters. Reads the current manga's preference fresh from localStorage every run so
  // navigating between manga never picks up another manga's stale preference from state.
  useEffect(() => {
    if (!id) return
    setChaptersLoading(true)
    setChapters([])
    setSourceCounts({})
    setActiveSource('mangadex')

    // Always read fresh — state may lag one render behind when id just changed
    const pref = (localStorage.getItem(`chapter-source:${id}`) as SourcePref | null) ?? 'auto'

    const load = async () => {
      const mangaData = await getManga(id)

      // Always fetch both sources so both counts are always visible on the buttons
      const [mdChapters, mpResult] = await Promise.all([
        getChapters(id).catch(() => [] as Chapter[]),
        findMangapillManga(mangaData.title).catch(() => null),
      ])
      const mpChapters = mpResult
        ? await getMangapillChapters(mpResult.url).catch(() => [] as Chapter[])
        : []

      setSourceCounts({ mangadex: mdChapters.length, mangapill: mpChapters.length })

      if (pref === 'mangadex') {
        if (mdChapters.length > 0) { setChapters(mdChapters); setActiveSource('mangadex') }
        return
      }

      if (pref === 'mangapill') {
        if (mpChapters.length > 0) { setChapters(mpChapters); setActiveSource('mangapill') }
        return
      }

      // auto: pick whichever source has more chapters
      if (mpChapters.length > mdChapters.length) {
        setChapters(mpChapters)
        setActiveSource('mangapill')
      } else if (mdChapters.length > 0) {
        setChapters(mdChapters)
        setActiveSource('mangadex')
      }
    }

    load().catch(err => console.error('[chapters]', err)).finally(() => setChaptersLoading(false))
  }, [id, sourcePref])

  function handleSourceSelect(src: 'mangadex' | 'mangapill') {
    if (src === activeSource) return
    localStorage.setItem(`chapter-source:${id!}`, src)
    setSourcePref(src) // triggers effect re-run; effect will re-read from localStorage
  }

  if (loading) {
    return (
      <div>
        <div className={styles.skeletonHero}>
          <div className={styles.skeletonCover} />
          <div className={styles.skeletonMeta}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={styles.skeletonLine} style={{ width: `${60 + i * 8}%` }} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error || !manga) {
    return (
      <div className={styles.notFound}>
        <p>{error ?? 'Manga not found.'}</p>
        <Link to="/">Back to Catalogue</Link>
      </div>
    )
  }

  const latestChapter = chapters.at(-1)
  const displayChapters = sortAsc ? chapters : [...chapters].reverse()

  async function saveAllChapters() {
    if (!manga || savingAll) return
    const toDownload = chapters.filter(
      (ch) => statuses[ch.id]?.status !== 'downloaded' && statuses[ch.id]?.status !== 'downloading',
    )
    if (toDownload.length === 0) return
    setSavingAll(true)
    setSaveAllProgress({ done: 0, total: toDownload.length })
    for (const chapter of toDownload) {
      await downloadChapter(chapter.id, {
        mangaId: manga.id,
        mangaTitle: manga.title,
        coverUrl: manga.coverUrl,
        chapterNumber: chapter.number,
        chapterTitle: chapter.title,
      })
      setSaveAllProgress((p) => ({ ...p, done: p.done + 1 }))
    }
    setSavingAll(false)
  }

  async function downloadAllSaved() {
    if (!manga || pdfAllProgress) return
    const saved = chapters
      .filter((ch) => statuses[ch.id]?.status === 'downloaded')
      .map((ch) => ({ chapterId: ch.id, info: statuses[ch.id] }))
    if (saved.length === 0) return
    setPdfAllProgress({ done: 0, total: saved.length })
    try {
      const { downloadAllChaptersAsZip } = await import('../services/download')
      await downloadAllChaptersAsZip(saved, manga.title, (done, total) =>
        setPdfAllProgress({ done, total }),
      )
    } finally {
      setPdfAllProgress(null)
    }
  }

  const downloadedCount = chapters.filter(
    (ch) => statuses[ch.id]?.status === 'downloaded',
  ).length

  return (
    <div>
      <button className={styles.back} onClick={() => navigate(-1)}>
        ← Back
      </button>

      <div className={styles.hero}>
        <img src={manga.coverUrl} alt={manga.title} className={styles.cover} />
        <div className={styles.meta}>
          <h1 className={styles.title}>{manga.title}</h1>

          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Author</span>
            <span>{manga.author}</span>
          </div>
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Artist</span>
            <span>{manga.artist}</span>
          </div>
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Status</span>
            <span
              className={styles.statusBadge}
              style={{ backgroundColor: STATUS_COLORS[manga.status] }}
            >
              {manga.status}
            </span>
          </div>

          <div className={styles.genres}>
            {manga.genres.map((g) => (
              <span key={g} className={styles.genre}>{g}</span>
            ))}
          </div>

          {manga.synopsis && <p className={styles.synopsis}>{manga.synopsis}</p>}

          <div className={styles.actions}>
            {latestChapter && (
              <Link
                to={`/manga/${manga.id}/chapter/${encodeURIComponent(latestChapter.id)}`}
                className={styles.readBtn}
              >
                Read Latest — Ch. {latestChapter.number}
              </Link>
            )}
            {chapters.length > 0 && (
              <button
                className={styles.saveAllBtn}
                onClick={saveAllChapters}
                disabled={savingAll || chaptersLoading}
              >
                {savingAll
                  ? `Saving ${saveAllProgress.done} / ${saveAllProgress.total}…`
                  : downloadedCount === chapters.length && chapters.length > 0
                  ? '✓ All Saved'
                  : `↓ Save All (${chapters.length - downloadedCount} left)`}
              </button>
            )}
            {downloadedCount > 0 && (
              <button
                className={styles.saveAllBtn}
                onClick={downloadAllSaved}
                disabled={pdfAllProgress !== null}
              >
                {pdfAllProgress
                  ? `Generating ${pdfAllProgress.done} / ${pdfAllProgress.total}…`
                  : `⬇ PDF All (${downloadedCount})`}
              </button>
            )}
          </div>
        </div>
      </div>

      <section className={styles.chapterSection}>
        <div className={styles.chapterHeader}>
          <h2 className={styles.chapterHeading}>
            Chapters{' '}
            <span className={styles.chapterCount}>
              {chaptersLoading ? '…' : chapters.length}
            </span>
          </h2>
          {downloadedCount > 0 && (
            <span className={styles.downloadedBadge}>
              {downloadedCount} saved offline
            </span>
          )}
          {chapters.some((ch) => readStatuses[ch.id]) && (
            <button
              className={styles.markAllUnreadBtn}
              onClick={() => {
                if (window.confirm(`Mark all chapters of "${manga.title}" as unread?`)) {
                  markAllUnread(manga.id)
                }
              }}
            >
              Mark all unread
            </button>
          )}
          <div className={styles.sourceToggle}>
            {(['mangadex', 'mangapill'] as const).map(src => {
              const isActive = activeSource === src
              const count = sourceCounts[src]
              const unavailable = count === 0
              const label = src === 'mangadex' ? 'MangaDex' : 'Mangapill'
              return (
                <button
                  key={src}
                  className={`${styles.sourceBtn} ${isActive ? styles.sourceBtnActive : ''} ${unavailable ? styles.sourceBtnUnavailable : ''}`}
                  onClick={() => handleSourceSelect(src)}
                  disabled={unavailable}
                  title={unavailable ? `No chapters available on ${label}` : `Switch to ${label}`}
                >
                  {label}{count !== undefined ? ` (${count})` : ''}
                </button>
              )
            })}
          </div>
          <button
            className={styles.sortBtn}
            onClick={() => setSortAsc((v) => !v)}
            title="Toggle sort order"
          >
            {sortAsc ? 'Ch. 1 → Latest' : 'Latest → Ch. 1'}
          </button>
        </div>

        {chaptersLoading ? (
          <div className={styles.chapterList}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={styles.skeletonRow} />
            ))}
          </div>
        ) : chapters.length === 0 ? (
          <p className={styles.noChapters}>No English chapters available yet.</p>
        ) : (
          <div className={styles.chapterList}>
            {displayChapters.map((chapter) => {
              const dlStatus = statuses[chapter.id]?.status ?? 'idle'
              const readProg = readStatuses[chapter.id]
              return (
                <div key={chapter.id} className={styles.chapterRow}>
                  <Link
                    to={`/manga/${manga.id}/chapter/${encodeURIComponent(chapter.id)}`}
                    className={styles.chapterLink}
                  >
                    {chapter.volume && (
                      <span className={styles.volumeBadge}>Vol.{chapter.volume}</span>
                    )}
                    <span className={styles.chapterNum}>Ch. {chapter.number}</span>
                    <span className={styles.chapterTitle}>{chapter.title}</span>
                    {dlStatus === 'downloaded' && (
                      <span className={styles.offlineDot} title="Available offline" />
                    )}
                    {readProg?.completed && (
                      <span className={styles.readTag}>Read</span>
                    )}
                    {readProg && !readProg.completed && readProg.totalPages > 0 && (
                      <span className={styles.progressTag}>
                        p.{readProg.lastPage + 1}/{readProg.totalPages}
                      </span>
                    )}
                  </Link>
                  <div className={styles.chapterRight}>
                    {readProg && (
                      <button
                        className={styles.markUnreadBtn}
                        onClick={(e) => { e.preventDefault(); markUnread(chapter.id) }}
                        title="Mark as unread"
                      >
                        Unread
                      </button>
                    )}
                    {chapter.scanlationGroup && (
                      <span className={styles.group}>{chapter.scanlationGroup}</span>
                    )}
                    <span className={styles.chapterDate}>{chapter.uploadedAt}</span>
                    {dlStatus === 'downloaded' && (
                      <button
                        className={styles.pdfBtn}
                        disabled={pdfGenerating === chapter.id}
                        onClick={async (e) => {
                          e.preventDefault()
                          setPdfGenerating(chapter.id)
                          try {
                            const { downloadChapterAsPDF } = await import('../services/download')
                            await downloadChapterAsPDF(chapter.id, statuses[chapter.id])
                          } finally {
                            setPdfGenerating(null)
                          }
                        }}
                        title="Download as PDF"
                      >
                        {pdfGenerating === chapter.id ? '…' : '⬇ PDF'}
                      </button>
                    )}
                    <DownloadButton
                      chapterId={chapter.id}
                      meta={{
                        mangaId: manga.id,
                        mangaTitle: manga.title,
                        coverUrl: manga.coverUrl,
                        chapterNumber: chapter.number,
                        chapterTitle: chapter.title,
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

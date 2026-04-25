import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { getManga, getChapters } from '../services/mangadex'
import { findMangaHid, getComickChapters } from '../services/comick'
import { useDownloads } from '../context/DownloadContext'
import DownloadButton from '../components/DownloadButton/DownloadButton'
import type { Manga, Chapter } from '../types'
import styles from './MangaDetail.module.css'

const STATUS_COLORS: Record<string, string> = {
  Ongoing: '#2ecc71',
  Completed: '#3498db',
  Hiatus: '#f39c12',
}

export default function MangaDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { statuses, downloadChapter } = useDownloads()

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

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setChaptersLoading(true)
    setError(null)

    const mangaPromise = getManga(id)
    mangaPromise.then(setManga).catch(() => setError('Failed to load manga.')).finally(() => setLoading(false))

    Promise.all([mangaPromise, getChapters(id)])
      .then(async ([mangaData, mdChapters]) => {
        if (mdChapters.length > 0) { setChapters(mdChapters); return }
        const hid = await findMangaHid(mangaData.title)
        if (!hid) return
        const comickChapters = await getComickChapters(hid)
        if (comickChapters.length > 0) setChapters(comickChapters)
      })
      .catch((err) => console.error('[chapters]', err))
      .finally(() => setChaptersLoading(false))
  }, [id])

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
                to={`/manga/${manga.id}/chapter/${latestChapter.id}`}
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
              return (
                <div key={chapter.id} className={styles.chapterRow}>
                  <Link
                    to={`/manga/${manga.id}/chapter/${chapter.id}`}
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
                  </Link>
                  <div className={styles.chapterRight}>
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

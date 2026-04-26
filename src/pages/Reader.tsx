import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { getManga, getChapters, getChapterPages } from '../services/mangadex'
import { getMangapillChapterPages, findMangapillManga, getMangapillChapters } from '../services/mangapill'
import { getPage } from '../services/storage'
import { useDownloads } from '../context/DownloadContext'
import DownloadButton from '../components/DownloadButton/DownloadButton'
import type { Chapter } from '../types'
import styles from './Reader.module.css'

export default function Reader() {
  const { id: mangaId, chapterId } = useParams<{ id: string; chapterId: string }>()
  const navigate = useNavigate()
  const { statuses } = useDownloads()

  const [pages, setPages] = useState<string[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [pagesLoading, setPagesLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [externalChapter, setExternalChapter] = useState(false)
  const blobUrls = useRef<string[]>([])

  const currentChapter = chapters.find((c) => c.id === chapterId)
  const chapterIndex = chapters.findIndex((c) => c.id === chapterId)
  const prevChapter = chapterIndex > 0 ? chapters[chapterIndex - 1] : null
  const nextChapter = chapterIndex >= 0 && chapterIndex < chapters.length - 1
    ? chapters[chapterIndex + 1]
    : null

  // Load chapter list for navigation.
  // Use the source that matches the current chapter — don't use MangaDex nav for a Mangapill chapter.
  useEffect(() => {
    if (!mangaId) return
    const loadNav = async () => {
      if (chapterId?.startsWith('mangapill:')) {
        const manga = await getManga(mangaId)
        const result = await findMangapillManga(manga.title)
        if (!result) return
        const mpChapters = await getMangapillChapters(result.url)
        if (mpChapters.length > 0) setChapters(mpChapters)
      } else {
        const mdChapters = await getChapters(mangaId)
        if (mdChapters.length > 0) setChapters(mdChapters)
      }
    }
    loadNav().catch(() => {})
  }, [mangaId])

  // Load pages — from IndexedDB if downloaded, otherwise from MangaDex CDN
  useEffect(() => {
    if (!chapterId) return
    window.scrollTo(0, 0)
    setPagesLoading(true)
    setError(null)
    setExternalChapter(false)

    // Revoke previous blob URLs to free memory
    blobUrls.current.forEach((u) => URL.revokeObjectURL(u))
    blobUrls.current = []

    const info = statuses[chapterId]
    const isDownloaded = info?.status === 'downloaded'

    const loadPages = async () => {
      if (isDownloaded && info.totalPages > 0) {
        const blobs = await Promise.all(
          Array.from({ length: info.totalPages }, (_, i) => getPage(chapterId, i)),
        )
        const urls = blobs.map((b) => {
          if (!b) return ''
          const url = URL.createObjectURL(b)
          blobUrls.current.push(url)
          return url
        })
        setPages(urls.filter(Boolean))
      } else if (chapterId.startsWith('mangapill:')) {
        const chapterPath = chapterId.slice('mangapill:'.length)
        const urls = await getMangapillChapterPages(chapterPath)
        if (urls.length === 0) setExternalChapter(true)
        else setPages(urls)
      } else {
        const urls = await getChapterPages(chapterId)
        if (urls.length === 0) {
          setExternalChapter(true)
        } else {
          setPages(urls)
        }
      }
      setPagesLoading(false)
    }

    loadPages().catch(() => {
      setError('Failed to load pages. Check your connection.')
      setPagesLoading(false)
    })

    return () => {
      blobUrls.current.forEach((u) => URL.revokeObjectURL(u))
      blobUrls.current = []
    }
  }, [chapterId, statuses])

  if (error) {
    return (
      <div className={styles.centered}>
        <p className={styles.errorMsg}>{error}</p>
        <button className={styles.retryBtn} onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      {/* Top bar */}
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>
          ← {currentChapter ? `Ch. ${currentChapter.number}` : 'Back'}
        </button>

        {currentChapter && (
          <span className={styles.chapterLabel}>
            {currentChapter.title}
          </span>
        )}

        <div className={styles.topActions}>
          {currentChapter && <DownloadButton chapterId={currentChapter.id} />}
          <div className={styles.chapterNav}>
            {prevChapter ? (
              <Link
                to={`/manga/${mangaId}/chapter/${encodeURIComponent(prevChapter.id)}`}
                replace
                className={styles.navBtn}
              >
                ← Prev
              </Link>
            ) : (
              <span className={styles.navBtnDisabled}>← Prev</span>
            )}
            {nextChapter ? (
              <Link
                to={`/manga/${mangaId}/chapter/${encodeURIComponent(nextChapter.id)}`}
                replace
                className={styles.navBtn}
              >
                Next →
              </Link>
            ) : (
              <span className={styles.navBtnDisabled}>Next →</span>
            )}
          </div>
        </div>
      </div>

      {/* Pages */}
      <div className={styles.pages}>
        {pagesLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={styles.pageSkeleton} />
          ))
        ) : externalChapter ? (
          <div className={styles.externalMsg}>
            <p>This chapter cannot be read here.</p>
            <p className={styles.externalHint}>
              {chapterId?.startsWith('mangapill:')
                ? 'The pages for this chapter could not be loaded from Mangapill.'
                : 'This chapter is hosted externally by the scanlation group. Try switching to Mangapill on the manga page — it may be available there.'}
            </p>
          </div>
        ) : (
          pages.map((src, i) => (
            <img
              key={`${chapterId}-${i}`}
              src={src}
              alt={`Page ${i + 1}`}
              className={styles.pageImg}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ))
        )}
      </div>

      {/* Bottom bar */}
      <div className={styles.bottomBar}>
        {prevChapter ? (
          <Link
            to={`/manga/${mangaId}/chapter/${encodeURIComponent(prevChapter.id)}`}
            replace
            className={styles.navBtn}
          >
            ← Ch. {prevChapter.number}
          </Link>
        ) : (
          <span />
        )}
        <Link to={`/manga/${mangaId}`} className={styles.chapterListLink}>
          Chapter List
        </Link>
        {nextChapter ? (
          <Link
            to={`/manga/${mangaId}/chapter/${encodeURIComponent(nextChapter.id)}`}
            replace
            className={styles.navBtn}
          >
            Ch. {nextChapter.number} →
          </Link>
        ) : (
          <span />
        )}
      </div>
    </div>
  )
}

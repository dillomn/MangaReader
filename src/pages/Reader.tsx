import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { getManga, getChapters, getChapterPages, reportAtHomeResult } from '../services/mangadex'
import { getMangapillChapterPages, findMangapillManga, getMangapillChapters } from '../services/mangapill'
import { getPage } from '../services/storage'
import { useDownloads } from '../context/DownloadContext'
import { useReadProgress } from '../context/ReadProgressContext'
import DownloadButton from '../components/DownloadButton/DownloadButton'
import type { Chapter, Manga } from '../types'
import styles from './Reader.module.css'

export default function Reader() {
  const { id: mangaId, chapterId } = useParams<{ id: string; chapterId: string }>()
  const navigate = useNavigate()
  const { statuses } = useDownloads()
  const { readStatuses, updateProgress, markUnread } = useReadProgress()

  const [pages, setPages] = useState<string[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [manga, setManga] = useState<Manga | null>(null)
  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const [pageRatios, setPageRatios] = useState<Record<number, 'spread' | 'single'>>({})
  const [failedPages, setFailedPages] = useState<Set<number>>(new Set())
  const [retryKeys, setRetryKeys] = useState<Record<number, number>>({})
  const [reloadKey, setReloadKey] = useState(0)
  // Only set after pages have fully loaded for the current chapter.
  // Prevents the progress-save effect from firing with stale state during chapter transitions.
  const [loadedChapterId, setLoadedChapterId] = useState<string | null>(null)
  const [pagesLoading, setPagesLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [externalChapter, setExternalChapter] = useState(false)
  const blobUrls = useRef<string[]>([])
  // How many times we've swapped the CDN node for this chapter load (max 5)
  const cdnRefreshCountRef = useRef(0)
  // Prevents concurrent refreshes racing each other
  const cdnRefreshingRef = useRef(false)
  // Tracks when the current page started loading (for report duration)
  const pageLoadStartRef = useRef<number>(Date.now())

  // Stable refs — keyboard handler and progress resume both read these without becoming deps
  const pagesRef = useRef<string[]>([])
  pagesRef.current = pages
  const readStatusesRef = useRef(readStatuses)
  readStatusesRef.current = readStatuses

  const currentChapter = chapters.find((c) => c.id === chapterId)
  const chapterIndex = chapters.findIndex((c) => c.id === chapterId)
  const prevChapter = chapterIndex > 0 ? chapters[chapterIndex - 1] : null
  const nextChapter = chapterIndex >= 0 && chapterIndex < chapters.length - 1
    ? chapters[chapterIndex + 1]
    : null

  // Load chapter list + manga metadata
  useEffect(() => {
    if (!mangaId) return
    const loadNav = async () => {
      const mangaData = await getManga(mangaId)
      setManga(mangaData)
      if (chapterId?.startsWith('mangapill:')) {
        const result = await findMangapillManga(mangaData.title)
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

  // Reset state on chapter change
  useEffect(() => {
    setCurrentPageIndex(0)
    setPageRatios({})
    setFailedPages(new Set())
    setRetryKeys({})
    setReloadKey(0)
    setLoadedChapterId(null)
    cdnRefreshCountRef.current = 0
    cdnRefreshingRef.current = false
  }, [chapterId])

  // Load pages — reruns when reloadKey increments (manual reload)
  useEffect(() => {
    if (!chapterId) return
    window.scrollTo(0, 0)
    setPagesLoading(true)
    setError(null)
    setExternalChapter(false)
    setPages([])
    setFailedPages(new Set())

    blobUrls.current.forEach((u) => URL.revokeObjectURL(u))
    blobUrls.current = []

    const info = statuses[chapterId]
    const isDownloaded = info?.status === 'downloaded'
    const isInitialLoad = reloadKey === 0

    const loadPages = async () => {
      let urlCount = 0
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
        const filtered = urls.filter(Boolean)
        setPages(filtered)
        urlCount = filtered.length
      } else if (chapterId.startsWith('mangapill:')) {
        const chapterPath = chapterId.slice('mangapill:'.length)
        const urls = await getMangapillChapterPages(chapterPath)
        if (urls.length === 0) setExternalChapter(true)
        else { setPages(urls); urlCount = urls.length }
      } else {
        const urls = await getChapterPages(chapterId)
        if (urls.length === 0) setExternalChapter(true)
        else { setPages(urls); urlCount = urls.length }
      }

      // Resume from saved position on first open (not on manual reload)
      if (isInitialLoad && urlCount > 0) {
        const saved = readStatusesRef.current[chapterId]
        if (saved && !saved.completed && saved.lastPage > 0 && saved.lastPage < urlCount) {
          setCurrentPageIndex(saved.lastPage)
        }
      }

      setLoadedChapterId(chapterId)
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
  }, [chapterId, statuses, reloadKey])

  // Preload next two pages
  useEffect(() => {
    if (pages.length === 0) return
    ;[currentPageIndex + 1, currentPageIndex + 2].forEach((i) => {
      if (i < pages.length) {
        const img = new Image()
        img.src = pages[i]
      }
    })
  }, [currentPageIndex, pages])

  // Auto-save read progress — only fires once pages belong to the current chapter
  useEffect(() => {
    if (!chapterId || !mangaId || pagesLoading || pages.length === 0) return
    if (loadedChapterId !== chapterId) return
    updateProgress(chapterId, mangaId, currentPageIndex, pages.length)
  }, [currentPageIndex, pages.length, chapterId, mangaId, pagesLoading, loadedChapterId, updateProgress])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setCurrentPageIndex((i) => Math.min(pagesRef.current.length - 1, i + 1))
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setCurrentPageIndex((i) => Math.max(0, i - 1))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  function goPrev() { pageLoadStartRef.current = Date.now(); setCurrentPageIndex((i) => Math.max(0, i - 1)) }
  function goNext() { pageLoadStartRef.current = Date.now(); setCurrentPageIndex((i) => Math.min(pagesRef.current.length - 1, i + 1)) }

  function handleViewerClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    if (e.clientX - rect.left < rect.width / 2) goPrev()
    else goNext()
  }

  async function handlePageError(pageIndex: number) {
    const failedUrl = pagesRef.current[pageIndex]
    // Only treat as CDN URL when it's the actual CDN host, not a proxy URL
    // that happens to contain "mangadex.network" in its query string.
    const isMangaDexCdn = !!failedUrl && !failedUrl.startsWith('/api/') && failedUrl.includes('mangadex.network')
    if (isMangaDexCdn) {
      reportAtHomeResult(failedUrl, false, Date.now() - pageLoadStartRef.current, 0)
    }

    const isMangaDex = chapterId && !chapterId.startsWith('mangapill:') && statuses[chapterId]?.status !== 'downloaded'
    if (!isMangaDex) { setFailedPages(prev => new Set([...prev, pageIndex])); return }

    // Phase 1: swap the CDN node up to 3 times — alternates between the
    // port-443 pool and the regular pool so each retry hits different nodes.
    if (!cdnRefreshingRef.current && cdnRefreshCountRef.current < 3) {
      cdnRefreshingRef.current = true
      const attempt = ++cdnRefreshCountRef.current   // 1, 2, or 3
      const usePort443 = attempt % 2 === 1           // attempts 1 & 3 → port-443, attempt 2 → regular
      try {
        const freshUrls = await getChapterPages(chapterId!, true, usePort443)
        if (freshUrls.length > 0) {
          setPages(freshUrls)
          setRetryKeys(prev => ({ ...prev, [pageIndex]: (prev[pageIndex] ?? 0) + 1 }))
          cdnRefreshingRef.current = false
          return
        }
      } catch {}
      cdnRefreshingRef.current = false
    }

    // Phase 2: all regional CDN nodes seem broken for this page — fall back to
    // server-side proxy which makes its own at-home API call with a different
    // outbound IP and User-Agent, getting a node outside the browser's geo pool.
    const originalUrl = failedUrl ?? pagesRef.current[pageIndex]
    if (isMangaDexCdn && originalUrl && !originalUrl.startsWith('/api/')) {
      const proxyUrl = `/api/manga-page?url=${encodeURIComponent(originalUrl)}&chapterId=${encodeURIComponent(chapterId!)}`
      setPages(prev => prev.map((u, i) => i === pageIndex ? proxyUrl : u))
      setRetryKeys(prev => ({ ...prev, [pageIndex]: (prev[pageIndex] ?? 0) + 1 }))
      return
    }

    setFailedPages((prev) => new Set([...prev, pageIndex]))
  }

  function retryPage() {
    setFailedPages((prev) => { const next = new Set(prev); next.delete(currentPageIndex); return next })
    setRetryKeys((prev) => ({ ...prev, [currentPageIndex]: (prev[currentPageIndex] ?? 0) + 1 }))
  }

  function reloadChapter() {
    cdnRefreshCountRef.current = 0
    cdnRefreshingRef.current = false
    setRetryKeys({})
    setReloadKey((k) => k + 1)
  }

  if (error) {
    return (
      <div className={styles.centered}>
        <p className={styles.errorMsg}>{error}</p>
        <button className={styles.retryBtn} onClick={reloadChapter}>Retry</button>
      </div>
    )
  }

  const isSpread = pageRatios[currentPageIndex] === 'spread'
  const currentRead = chapterId ? readStatuses[chapterId] : undefined

  const downloadMeta = manga && currentChapter ? {
    mangaId: manga.id,
    mangaTitle: manga.title,
    coverUrl: manga.coverUrl,
    chapterNumber: currentChapter.number,
    chapterTitle: currentChapter.title,
  } : undefined

  return (
    <div className={styles.root}>
      {/* Top bar */}
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>
          ← {currentChapter ? `Ch. ${currentChapter.number}` : 'Back'}
        </button>

        {currentChapter && (
          <span className={styles.chapterLabel}>{currentChapter.title}</span>
        )}

        <div className={styles.topActions}>
          {currentRead && chapterId && (
            <button
              className={styles.unreadBtn}
              onClick={() => markUnread(chapterId)}
              title="Mark as unread"
            >
              ✓ Read
            </button>
          )}
          {currentChapter && (
            <DownloadButton chapterId={currentChapter.id} meta={downloadMeta} />
          )}
          <div className={styles.chapterNav}>
            {prevChapter ? (
              <Link to={`/manga/${mangaId}/chapter/${encodeURIComponent(prevChapter.id)}`} replace className={styles.navBtn}>
                ← Prev
              </Link>
            ) : (
              <span className={styles.navBtnDisabled}>← Prev</span>
            )}
            {nextChapter ? (
              <Link to={`/manga/${mangaId}/chapter/${encodeURIComponent(nextChapter.id)}`} replace className={styles.navBtn}>
                Next →
              </Link>
            ) : (
              <span className={styles.navBtnDisabled}>Next →</span>
            )}
          </div>
        </div>
      </div>

      {/* Page viewer */}
      <div
        className={styles.viewer}
        onClick={!pagesLoading && !externalChapter && pages.length > 0 && !failedPages.has(currentPageIndex)
          ? handleViewerClick
          : undefined}
      >
        {pagesLoading ? (
          <div className={styles.pageSkeleton} />
        ) : externalChapter ? (
          <div className={styles.externalMsg}>
            <p>This chapter cannot be read here.</p>
            <p className={styles.externalHint}>
              {chapterId?.startsWith('mangapill:')
                ? 'The pages for this chapter could not be loaded from Mangapill.'
                : 'This chapter is hosted externally. Try switching to Mangapill on the manga page.'}
            </p>
          </div>
        ) : failedPages.has(currentPageIndex) ? (
          <div className={styles.pageErrorMsg}>
            <p>Page {currentPageIndex + 1} failed to load.</p>
            <div className={styles.pageErrorActions}>
              <button className={styles.retryBtn} onClick={retryPage}>Retry page</button>
              <button className={styles.reloadBtn} onClick={reloadChapter}>Reload chapter</button>
            </div>
          </div>
        ) : pages.length > 0 ? (
          <>
            <img
              key={`${chapterId}-${currentPageIndex}-${retryKeys[currentPageIndex] ?? 0}`}
              src={pages[currentPageIndex]}
              alt={`Page ${currentPageIndex + 1}`}
              className={isSpread ? styles.pageImgSpread : styles.pageImg}
              draggable={false}
              referrerPolicy="no-referrer"
              onLoad={(e) => {
                const img = e.currentTarget
                const ratio = img.naturalWidth / img.naturalHeight
                setPageRatios((prev) => ({
                  ...prev,
                  [currentPageIndex]: ratio > 1.2 ? 'spread' : 'single',
                }))
                const src = img.src
                if (src.includes('mangadex.network')) {
                  const duration = Date.now() - pageLoadStartRef.current
                  const entry = performance.getEntriesByName(src).at(-1) as PerformanceResourceTiming | undefined
                  reportAtHomeResult(src, true, duration, entry?.transferSize ?? 0)
                }
              }}
              onError={() => {
                pageLoadStartRef.current = Date.now()
                handlePageError(currentPageIndex)
              }}
            />
            <div className={styles.zoneLeft} />
            <div className={styles.zoneRight} />
          </>
        ) : null}
      </div>

      {/* Bottom bar */}
      <div className={styles.bottomBar}>
        {prevChapter ? (
          <Link to={`/manga/${mangaId}/chapter/${encodeURIComponent(prevChapter.id)}`} replace className={styles.navBtn}>
            ← Ch. {prevChapter.number}
          </Link>
        ) : <span />}

        <div className={styles.bottomCenter}>
          {!pagesLoading && pages.length > 0 && (
            <span className={styles.pageCounter}>
              {currentPageIndex + 1} / {pages.length}
            </span>
          )}
          <Link to={`/manga/${mangaId}`} className={styles.chapterListLink}>
            Chapter List
          </Link>
        </div>

        {nextChapter ? (
          <Link to={`/manga/${mangaId}/chapter/${encodeURIComponent(nextChapter.id)}`} replace className={styles.navBtn}>
            Ch. {nextChapter.number} →
          </Link>
        ) : <span />}
      </div>
    </div>
  )
}

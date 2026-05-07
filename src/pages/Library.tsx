import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDownloads } from '../context/DownloadContext'
import { useLibrary } from '../context/LibraryContext'
import type { DownloadInfo } from '../types'
import styles from './Library.module.css'

interface LibraryGroup {
  mangaId: string
  mangaTitle: string
  coverUrl: string
  chapters: Array<{ chapterId: string; info: DownloadInfo }>
  isBookmarked: boolean
}

function LibraryCard({
  group,
  onRemoved,
}: {
  group: LibraryGroup
  onRemoved: (mangaId: string) => Promise<void>
}) {
  const { deleteChapter } = useDownloads()
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const downloadedChapters = group.chapters.filter(({ info }) => info.status === 'downloaded')

  async function handleExportPDF(e: React.MouseEvent) {
    e.preventDefault()
    if (exportProgress) return
    setExportProgress({ done: 0, total: downloadedChapters.length })
    try {
      const { downloadAllChaptersAsZip } = await import('../services/download')
      await downloadAllChaptersAsZip(
        downloadedChapters,
        group.mangaTitle,
        (done, total) => setExportProgress({ done, total }),
      )
    } finally {
      setExportProgress(null)
    }
  }

  async function handleRemove(e: React.MouseEvent) {
    e.preventDefault()
    if (!confirmRemove) { setConfirmRemove(true); return }
    for (const { chapterId } of group.chapters) {
      await deleteChapter(chapterId)
    }
    await onRemoved(group.mangaId)
  }

  return (
    <div className={styles.card} onMouseLeave={() => setConfirmRemove(false)}>
      <Link to={`/manga/${group.mangaId}`} className={styles.cardLink}>
        <div className={styles.cover}>
          {group.coverUrl ? (
            <img src={group.coverUrl} alt={group.mangaTitle} loading="lazy" />
          ) : (
            <div className={styles.coverPlaceholder} />
          )}
          {downloadedChapters.length > 0 && (
            <span className={styles.savedBadge}>{downloadedChapters.length} saved</span>
          )}
        </div>
        <div className={styles.info}>
          <h3 className={styles.title}>{group.mangaTitle}</h3>
        </div>
      </Link>
      <div className={styles.cardFooter}>
        {downloadedChapters.length > 0 && (
          <button
            className={styles.downloadAllBtn}
            onClick={handleExportPDF}
            disabled={exportProgress !== null}
            title="Export saved chapters as PDF"
          >
            {exportProgress
              ? `${exportProgress.done} / ${exportProgress.total}…`
              : '⬇ Export PDF'}
          </button>
        )}
        <button
          className={`${styles.removeBtn} ${confirmRemove ? styles.removeBtnConfirm : ''}`}
          onClick={handleRemove}
          title="Remove from library"
        >
          {confirmRemove ? 'Confirm?' : '×'}
        </button>
      </div>
    </div>
  )
}

export default function Library() {
  const { statuses, syncReady } = useDownloads()
  const { bookmarks, loading: libraryLoading, removeBookmark } = useLibrary()

  if (!syncReady || libraryLoading) return <div className={styles.loading}>Loading library…</div>

  // Build groups from downloaded chapters
  const downloadedGroups = Object.entries(statuses)
    .filter(([, info]) => info.status === 'downloaded')
    .reduce<Record<string, LibraryGroup>>((acc, [chapterId, info]) => {
      const key = info.mangaId ?? '__unknown__'
      if (!acc[key]) {
        acc[key] = {
          mangaId: info.mangaId ?? '',
          mangaTitle: info.mangaTitle ?? 'Unknown Manga',
          coverUrl: info.coverUrl ?? '',
          chapters: [],
          isBookmarked: false,
        }
      }
      acc[key].chapters.push({ chapterId, info })
      return acc
    }, {})

  // Merge in bookmarks (may or may not have downloads)
  const allGroups = { ...downloadedGroups }
  for (const [mangaId, bookmark] of Object.entries(bookmarks)) {
    if (!allGroups[mangaId]) {
      allGroups[mangaId] = {
        mangaId,
        mangaTitle: bookmark.mangaTitle,
        coverUrl: bookmark.coverUrl,
        chapters: [],
        isBookmarked: true,
      }
    } else {
      allGroups[mangaId].isBookmarked = true
    }
  }

  const mangaList = Object.values(allGroups)
    .map((g) => ({
      ...g,
      chapters: [...g.chapters].sort(
        (a, b) => (a.info.chapterNumber ?? 0) - (b.info.chapterNumber ?? 0),
      ),
    }))
    .sort((a, b) => a.mangaTitle.localeCompare(b.mangaTitle))

  const totalChapters = Object.values(statuses).filter(
    (i) => i.status === 'downloaded',
  ).length

  if (mangaList.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>Your library is empty</p>
        <p className={styles.emptyHint}>
          Open any manga and click <strong>Save to Library</strong> — then use the{' '}
          <strong>Download</strong> button here to save chapters for offline reading.
        </p>
        <Link to="/" className={styles.browseBtn}>
          Browse Catalogue
        </Link>
      </div>
    )
  }

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.heading}>Library</h1>
        <span className={styles.subtitle}>
          {mangaList.length} series · {totalChapters} chapters saved
        </span>
      </div>

      <div className={styles.grid}>
        {mangaList.map((group) => (
          <LibraryCard
            key={group.mangaId || group.mangaTitle}
            group={group}
            onRemoved={removeBookmark}
          />
        ))}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDownloads } from '../context/DownloadContext'
import type { DownloadInfo } from '../types'
import styles from './Library.module.css'

interface LibraryGroup {
  mangaId: string
  mangaTitle: string
  coverUrl: string
  chapters: Array<{ chapterId: string; info: DownloadInfo }>
}

function LibraryCard({ group }: { group: LibraryGroup }) {
  const { deleteChapter } = useDownloads()
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  async function handleDownloadAll(e: React.MouseEvent) {
    e.preventDefault()
    if (progress) return
    setProgress({ done: 0, total: group.chapters.length })
    try {
      const { downloadAllChaptersAsZip } = await import('../services/download')
      await downloadAllChaptersAsZip(
        group.chapters,
        group.mangaTitle,
        (done, total) => setProgress({ done, total }),
      )
    } finally {
      setProgress(null)
    }
  }

  async function handleRemove(e: React.MouseEvent) {
    e.preventDefault()
    if (!confirmRemove) {
      setConfirmRemove(true)
      return
    }
    for (const { chapterId } of group.chapters) {
      await deleteChapter(chapterId)
    }
  }

  const isDownloading = progress !== null

  return (
    <div className={styles.card} onMouseLeave={() => setConfirmRemove(false)}>
      <Link to={`/manga/${group.mangaId}`} className={styles.cardLink}>
        <div className={styles.cover}>
          {group.coverUrl ? (
            <img src={group.coverUrl} alt={group.mangaTitle} loading="lazy" />
          ) : (
            <div className={styles.coverPlaceholder} />
          )}
          <span className={styles.savedBadge}>{group.chapters.length} saved</span>
        </div>
        <div className={styles.info}>
          <h3 className={styles.title}>{group.mangaTitle}</h3>
        </div>
      </Link>
      <div className={styles.cardFooter}>
        <button
          className={styles.downloadAllBtn}
          onClick={handleDownloadAll}
          disabled={isDownloading}
          title="Download all saved chapters as a ZIP of PDFs"
        >
          {isDownloading
            ? `Generating ${progress!.done} / ${progress!.total}…`
            : '⬇ Download All'}
        </button>
        <button
          className={`${styles.removeBtn} ${confirmRemove ? styles.removeBtnConfirm : ''}`}
          onClick={handleRemove}
          title="Remove all saved chapters"
        >
          {confirmRemove ? 'Confirm?' : '×'}
        </button>
      </div>
    </div>
  )
}

export default function Library() {
  const { statuses } = useDownloads()

  const groups = Object.entries(statuses)
    .filter(([, info]) => info.status === 'downloaded')
    .reduce<Record<string, LibraryGroup>>((acc, [chapterId, info]) => {
      const key = info.mangaId ?? '__unknown__'
      if (!acc[key]) {
        acc[key] = {
          mangaId: info.mangaId ?? '',
          mangaTitle: info.mangaTitle ?? 'Unknown Manga',
          coverUrl: info.coverUrl ?? '',
          chapters: [],
        }
      }
      acc[key].chapters.push({ chapterId, info })
      return acc
    }, {})

  const mangaList = Object.values(groups)
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
          Open any manga, then click <strong>↓ Save</strong> on a chapter — or use{' '}
          <strong>↓ Save All</strong> on the manga page to download the full series. Pages are
          stored locally in your browser for offline reading.
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
          <LibraryCard key={group.mangaId || group.mangaTitle} group={group} />
        ))}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import JSZip from 'jszip'
import { useDownloads } from '../context/DownloadContext'
import DownloadButton from '../components/DownloadButton/DownloadButton'
import { getPage } from '../services/storage'
import type { DownloadInfo } from '../types'
import styles from './Library.module.css'

async function downloadChapterZip(chapterId: string, info: DownloadInfo) {
  const zip = new JSZip()
  for (let i = 0; i < info.totalPages; i++) {
    const blob = await getPage(chapterId, i)
    if (blob) {
      const ext = blob.type.includes('png') ? 'png' : 'jpg'
      zip.file(`page${String(i + 1).padStart(3, '0')}.${ext}`, blob)
    }
  }
  const content = await zip.generateAsync({ type: 'blob' })
  const safeName = `${info.mangaTitle ?? 'manga'} - Ch${info.chapterNumber ?? '?'}`
    .replace(/[\\/:*?"<>|]/g, '_')
  const url = URL.createObjectURL(content)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeName}.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

interface LibraryGroup {
  mangaId: string
  mangaTitle: string
  coverUrl: string
  chapters: Array<{ chapterId: string; info: DownloadInfo }>
}

export default function Library() {
  const { statuses } = useDownloads()
  const [zipping, setZipping] = useState<string | null>(null)

  async function handleZipDownload(chapterId: string, info: DownloadInfo) {
    setZipping(chapterId)
    try {
      await downloadChapterZip(chapterId, info)
    } finally {
      setZipping(null)
    }
  }

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

  const mangaList = Object.values(groups).map((g) => ({
    ...g,
    chapters: [...g.chapters].sort(
      (a, b) => (a.info.chapterNumber ?? 0) - (b.info.chapterNumber ?? 0),
    ),
  }))

  if (mangaList.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>Your library is empty</p>
        <p className={styles.emptyHint}>
          Open any manga, then click <strong>↓ Save</strong> on a chapter to download it for
          offline reading. Pages are stored locally in your browser.
        </p>
        <Link to="/" className={styles.browseBtn}>
          Browse Catalogue
        </Link>
      </div>
    )
  }

  return (
    <div>
      <h1 className={styles.heading}>Library</h1>
      <p className={styles.subtitle}>
        {Object.values(statuses).filter((i) => i.status === 'downloaded').length} chapter
        {Object.values(statuses).filter((i) => i.status === 'downloaded').length !== 1 ? 's' : ''}{' '}
        saved offline
      </p>

      <div className={styles.mangaList}>
        {mangaList.map((group) => (
          <div key={group.mangaId || group.mangaTitle} className={styles.mangaCard}>
            <div className={styles.mangaHeader}>
              {group.coverUrl && (
                <img src={group.coverUrl} alt={group.mangaTitle} className={styles.cover} />
              )}
              <div className={styles.mangaInfo}>
                {group.mangaId ? (
                  <Link to={`/manga/${group.mangaId}`} className={styles.mangaTitle}>
                    {group.mangaTitle}
                  </Link>
                ) : (
                  <span className={styles.mangaTitle}>{group.mangaTitle}</span>
                )}
                <span className={styles.chapterCount}>
                  {group.chapters.length} chapter{group.chapters.length !== 1 ? 's' : ''} saved
                </span>
              </div>
            </div>

            <div className={styles.chapterList}>
              {group.chapters.map(({ chapterId, info }) => (
                <div key={chapterId} className={styles.chapterRow}>
                  {group.mangaId ? (
                    <Link
                      to={`/manga/${group.mangaId}/chapter/${chapterId}`}
                      className={styles.chapterLink}
                    >
                      <span className={styles.chapterNum}>
                        Ch. {info.chapterNumber ?? '?'}
                      </span>
                      <span className={styles.chapterTitle}>
                        {info.chapterTitle ?? chapterId}
                      </span>
                      <span className={styles.offlineBadge}>Offline</span>
                    </Link>
                  ) : (
                    <div className={styles.chapterLink}>
                      <span className={styles.chapterNum}>
                        Ch. {info.chapterNumber ?? '?'}
                      </span>
                      <span className={styles.chapterTitle}>
                        {info.chapterTitle ?? chapterId}
                      </span>
                    </div>
                  )}
                  <div className={styles.chapterActions}>
                    <button
                      className={styles.zipBtn}
                      onClick={() => handleZipDownload(chapterId, info)}
                      disabled={zipping === chapterId}
                      title="Download as ZIP to your device"
                    >
                      {zipping === chapterId ? '…' : '⬇ ZIP'}
                    </button>
                    <DownloadButton chapterId={chapterId} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

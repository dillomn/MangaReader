import { useDownloads, type ChapterMeta } from '../../context/DownloadContext'
import styles from './DownloadButton.module.css'

interface Props {
  chapterId: string
  meta?: ChapterMeta
}

export default function DownloadButton({ chapterId, meta }: Props) {
  const { statuses, downloadChapter, deleteChapter, cancelDownload } = useDownloads()
  const info = statuses[chapterId]
  const status = info?.status ?? 'idle'

  if (status === 'downloading') {
    return (
      <button
        className={styles.progressWrap}
        onClick={(e) => { e.preventDefault(); cancelDownload(chapterId) }}
        title={`${info.progress}% — click to cancel`}
      >
        <div className={styles.bar} style={{ width: `${info.progress}%` }} />
        <span className={styles.progressLabel}>{info.progress}% ×</span>
      </button>
    )
  }

  if (status === 'downloaded') {
    return (
      <button
        className={`${styles.btn} ${styles.delete}`}
        onClick={(e) => {
          e.preventDefault()
          deleteChapter(chapterId)
        }}
        title="Remove downloaded chapter"
      >
        ✓ Saved
      </button>
    )
  }

  if (status === 'error') {
    return (
      <button
        className={`${styles.btn} ${styles.error}`}
        onClick={(e) => {
          e.preventDefault()
          downloadChapter(chapterId, meta)
        }}
      >
        Retry
      </button>
    )
  }

  return (
    <button
      className={styles.btn}
      onClick={(e) => {
        e.preventDefault()
        downloadChapter(chapterId, meta)
      }}
      title="Save for offline reading"
    >
      ↓ Save
    </button>
  )
}

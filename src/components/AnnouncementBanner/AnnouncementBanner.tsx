import { useEffect, useState } from 'react'
import styles from './AnnouncementBanner.module.css'

const DISMISSED_KEY = 'announcement-dismissed'

interface Announcement {
  message: string
  createdAt: string
}

export default function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    fetch('/api/announcement')
      .then(r => r.json())
      .then((data: Announcement | null) => {
        if (!data?.message) return
        const dismissed = sessionStorage.getItem(DISMISSED_KEY)
        if (dismissed === data.createdAt) return
        setAnnouncement(data)
        setVisible(true)
      })
      .catch(() => {})
  }, [])

  function dismiss() {
    if (announcement) sessionStorage.setItem(DISMISSED_KEY, announcement.createdAt)
    setVisible(false)
  }

  if (!visible || !announcement) return null

  return (
    <div className={styles.banner}>
      <span className={styles.message}>{announcement.message}</span>
      <button className={styles.close} onClick={dismiss} aria-label="Dismiss">✕</button>
    </div>
  )
}

import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from './Admin.module.css'

type Tab = 'health' | 'users' | 'cache' | 'announcement'

interface Health {
  startedAt: string
  uptimeSeconds: number
  nodeVersion: string
  memory: { usedMb: number; totalMb: number }
  cacheEntries: number
}

interface User {
  id: string
  username: string
  isAdmin: boolean
  lastSeen: string
  createdAt: string
  downloadCount: number
  downloads: Download[]
}

interface Download {
  mangaId: string
  mangaTitle: string
  coverUrl: string
  chapterId: string
  chapterNumber: number
  chapterTitle: string
  downloadedAt: string
}

function formatUptime(secs: number) {
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ')
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ---- Health Tab ----

function HealthTab() {
  const { authFetch } = useAuth()
  const [health, setHealth] = useState<Health | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    authFetch('/admin-api/health')
      .then(r => r.json())
      .then(setHealth)
      .finally(() => setLoading(false))
  }, [authFetch])

  if (loading) return <div className={styles.loading}>Loading…</div>
  if (!health) return <div className={styles.empty}>Failed to load health data.</div>

  return (
    <div className={styles.statGrid}>
      <div className={styles.stat}>
        <div className={styles.statLabel}>Uptime</div>
        <div className={styles.statValue}>{formatUptime(health.uptimeSeconds)}</div>
      </div>
      <div className={styles.stat}>
        <div className={styles.statLabel}>Node.js</div>
        <div className={styles.statValue}>{health.nodeVersion}</div>
      </div>
      <div className={styles.stat}>
        <div className={styles.statLabel}>Memory</div>
        <div className={styles.statValue}>{health.memory.usedMb} / {health.memory.totalMb} MB</div>
      </div>
      <div className={styles.stat}>
        <div className={styles.statLabel}>Cache entries</div>
        <div className={styles.statValue}>{health.cacheEntries}</div>
      </div>
      <div className={styles.stat}>
        <div className={styles.statLabel}>Started at</div>
        <div className={styles.statValue}>{new Date(health.startedAt).toLocaleString()}</div>
      </div>
    </div>
  )
}

// ---- User activity drawer ----

type AuthFetchFn = (url: string, options?: RequestInit) => Promise<Response>

function UserActivityDrawer({
  userId,
  initialDownloads,
  authFetch,
  onCountChange,
}: {
  userId: string
  initialDownloads: Download[] | undefined
  authFetch: AuthFetchFn
  onCountChange: (delta: number) => void
}) {
  const [downloads, setDownloads] = useState<Download[]>(initialDownloads ?? [])
  const [removing, setRemoving] = useState<string | null>(null)

  async function handleRemoveManga(mangaId: string, chapterCount: number) {
    setRemoving(mangaId)
    await authFetch(`/admin-api/users/${userId}/downloads`, {
      method: 'DELETE',
      body: JSON.stringify({ mangaId }),
    })
    setDownloads(prev => prev.filter(d => d.mangaId !== mangaId))
    onCountChange(-chapterCount)
    setRemoving(null)
  }

  if (downloads.length === 0) return <div className={styles.drawerEmpty}>No chapters saved yet.</div>

  // Group by manga
  const byManga = new Map<string, { title: string; coverUrl: string; mangaId: string; chapters: Download[] }>()
  for (const d of downloads) {
    if (!byManga.has(d.mangaId)) byManga.set(d.mangaId, { mangaId: d.mangaId, title: d.mangaTitle, coverUrl: d.coverUrl, chapters: [] })
    byManga.get(d.mangaId)!.chapters.push(d)
  }

  return (
    <div className={styles.drawer}>
      {Array.from(byManga.values()).map(({ mangaId, title, coverUrl, chapters }) => (
        <div key={mangaId} className={styles.mangaGroup}>
          <img src={coverUrl} alt={title} className={styles.mangaGroupCover} />
          <div className={styles.mangaGroupInfo}>
            <div className={styles.mangaGroupTitle}>{title}</div>
            <div className={styles.mangaGroupCount}>{chapters.length} chapter{chapters.length !== 1 ? 's' : ''} saved</div>
          </div>
          <button
            className={styles.mangaRemoveBtn}
            onClick={() => handleRemoveManga(mangaId, chapters.length)}
            disabled={removing === mangaId}
            title="Remove from this user's library"
          >
            {removing === mangaId ? '…' : 'Remove'}
          </button>
        </div>
      ))}
    </div>
  )
}

// ---- Users Tab ----

function UsersTab() {
  const { authFetch } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    authFetch('/admin-api/users')
      .then(r => r.json())
      .then(setUsers)
      .finally(() => setLoading(false))
  }, [authFetch])

  if (loading) return <div className={styles.loading}>Loading…</div>
  if (users.length === 0) return <div className={styles.empty}>No users have logged in yet.</div>

  return (
    <div className={styles.table}>
      <div className={styles.tableHeader}>
        <span>Username</span>
        <span>Last seen</span>
        <span>Saved</span>
        <span>Role</span>
      </div>
      {users.map(u => (
        <div key={u.id}>
          <button
            className={`${styles.tableRow} ${styles.tableRowBtn} ${expanded === u.id ? styles.tableRowExpanded : ''}`}
            onClick={() => setExpanded(expanded === u.id ? null : u.id)}
          >
            <span className={styles.username}>{u.username}</span>
            <span className={styles.muted}>{timeAgo(u.lastSeen)}</span>
            <span className={styles.muted}>{u.downloadCount} ch.</span>
            <span>
              {u.isAdmin
                ? <span className={styles.adminBadge}>Admin</span>
                : <span className={styles.userBadge}>User</span>}
            </span>
          </button>
          {expanded === u.id && (
            <UserActivityDrawer
              userId={u.id}
              initialDownloads={u.downloads}
              authFetch={authFetch}
              onCountChange={(delta) =>
                setUsers(prev => prev.map(p => p.id === u.id
                  ? { ...p, downloadCount: Math.max(0, p.downloadCount + delta) }
                  : p))
              }
            />
          )}
        </div>
      ))}
    </div>
  )
}

// ---- Cache Tab ----

function CacheTab() {
  const { authFetch } = useAuth()
  const [health, setHealth] = useState<Health | null>(null)
  const [clearing, setClearing] = useState(false)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(true)

  function fetchHealth() {
    return authFetch('/admin-api/health').then(r => r.json()).then(setHealth)
  }

  useEffect(() => {
    fetchHealth().finally(() => setLoading(false))
  }, []) // eslint-disable-line

  async function clearCache() {
    setClearing(true)
    setDone(false)
    await authFetch('/admin-api/cache/clear', { method: 'POST' })
    await fetchHealth()
    setClearing(false)
    setDone(true)
  }

  if (loading) return <div className={styles.loading}>Loading…</div>

  return (
    <div className={styles.section}>
      <p className={styles.sectionText}>
        The proxy caches Mangapill search, chapter list, and page responses in memory for 5 minutes
        (page URLs cached for 1 hour). Clearing won't affect downloaded chapters stored offline.
      </p>
      <div className={styles.cacheInfo}>
        <span className={styles.cacheCount}>{health?.cacheEntries ?? '—'}</span>
        <span className={styles.muted}>entries currently cached</span>
      </div>
      <button
        className={styles.dangerBtn}
        onClick={clearCache}
        disabled={clearing}
      >
        {clearing ? 'Clearing…' : 'Clear cache'}
      </button>
      {done && <p className={styles.successMsg}>Cache cleared successfully.</p>}
    </div>
  )
}

// ---- Announcement Tab ----

function AnnouncementTab() {
  const { authFetch } = useAuth()
  const [current, setCurrent] = useState<string>('')
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/announcement')
      .then(r => r.json())
      .then(data => {
        const msg = data?.message ?? ''
        setCurrent(msg)
        setDraft(msg)
      })
      .finally(() => setLoading(false))
  }, [])

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    await authFetch('/admin-api/announcement', {
      method: 'POST',
      body: JSON.stringify({ message: draft }),
    })
    setCurrent(draft)
    setSaving(false)
    setSaved(true)
  }

  async function clear() {
    setSaving(true)
    await authFetch('/admin-api/announcement', { method: 'DELETE' })
    setCurrent('')
    setDraft('')
    setSaving(false)
    setSaved(true)
  }

  if (loading) return <div className={styles.loading}>Loading…</div>

  return (
    <div className={styles.section}>
      <p className={styles.sectionText}>
        Set a banner message displayed to all users at the top of every page.
        Leave blank to show nothing.
      </p>
      <form className={styles.announceForm} onSubmit={save}>
        <textarea
          className={styles.announceInput}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Announcement message… (leave empty to clear)"
          rows={3}
        />
        <div className={styles.announceActions}>
          <button className={styles.saveBtn} type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {current && (
            <button
              className={styles.clearBtn}
              type="button"
              onClick={clear}
              disabled={saving}
            >
              Clear banner
            </button>
          )}
        </div>
      </form>
      {saved && <p className={styles.successMsg}>Saved.</p>}
      {current && (
        <div className={styles.announcePreview}>
          <span className={styles.previewLabel}>Current banner:</span>
          <span>{current}</span>
        </div>
      )}
    </div>
  )
}

// ---- Admin page ----

const TABS: { key: Tab; label: string }[] = [
  { key: 'health', label: 'Health' },
  { key: 'users', label: 'Users' },
  { key: 'cache', label: 'Cache' },
  { key: 'announcement', label: 'Announcement' },
]

export default function Admin() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('health')

  if (!user?.isAdmin) {
    navigate('/', { replace: true })
    return null
  }

  return (
    <div className={styles.root}>
      <h1 className={styles.heading}>Admin Portal</h1>

      <div className={styles.tabs}>
        {TABS.map(t => (
          <button
            key={t.key}
            className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles.panel}>
        {tab === 'health' && <HealthTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'cache' && <CacheTab />}
        {tab === 'announcement' && <AnnouncementTab />}
      </div>
    </div>
  )
}

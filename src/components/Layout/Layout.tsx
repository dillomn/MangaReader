import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate, Outlet } from 'react-router-dom'
import { getRandomManga } from '../../services/mangadex'
import { useAuth } from '../../context/AuthContext'
import AnnouncementBanner from '../AnnouncementBanner/AnnouncementBanner'
import styles from './Layout.module.css'

export default function Layout() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [randomizing, setRandomizing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  async function goRandom() {
    if (randomizing) return
    setRandomizing(true)
    try {
      const m = await getRandomManga()
      navigate(`/manga/${m.id}`)
    } catch {}
    finally { setRandomizing(false) }
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <Link to="/" className={styles.logo}>
          MangaReader
        </Link>
        <nav className={styles.nav}>
          <Link to="/" className={styles.navLink}>Catalogue</Link>
          <Link to="/explore" className={styles.navLink}>Explore</Link>
          <Link to="/library" className={styles.navLink}>Library</Link>
        </nav>
        <button className={styles.randomBtn} onClick={goRandom} disabled={randomizing}>
          {randomizing ? '...' : '↺ Random'}
        </button>

        <div className={styles.userMenu} ref={menuRef}>
          <button
            className={styles.userBtn}
            onClick={() => setMenuOpen(v => !v)}
            title={user?.username}
          >
            <span className={styles.userAvatar}>{user?.username?.[0]?.toUpperCase()}</span>
            <span className={styles.userLabel}>{user?.username}</span>
            {user?.isAdmin && <span className={styles.adminDot} title="Admin" />}
          </button>
          {menuOpen && (
            <div className={styles.dropdown}>
              {user?.isAdmin && (
                <Link
                  to="/admin"
                  className={styles.dropdownItem}
                  onClick={() => setMenuOpen(false)}
                >
                  Admin Portal
                </Link>
              )}
              <button
                className={styles.dropdownItem}
                onClick={() => { logout(); navigate('/login') }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <AnnouncementBanner />

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}

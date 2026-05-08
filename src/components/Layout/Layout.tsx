import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate, Outlet } from 'react-router-dom'
import { getRandomManga } from '../../services/mangadex'
import { useAuth } from '../../context/AuthContext'
import AnnouncementBanner from '../AnnouncementBanner/AnnouncementBanner'
import UpdateBanner from '../UpdateBanner/UpdateBanner'
import styles from './Layout.module.css'

export default function Layout() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [randomizing, setRandomizing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLDivElement>(null)

  async function goRandom() {
    if (randomizing) return
    setRandomizing(true)
    setNavOpen(false)
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
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setNavOpen(false)
      }
    }
    if (menuOpen || navOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen, navOpen])

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.navWrap} ref={navRef}>
          <button
            className={styles.hamburger}
            onClick={() => setNavOpen(v => !v)}
            aria-label="Toggle navigation"
          >
            <span /><span /><span />
          </button>
          <Link to="/" className={styles.logo} onClick={() => setNavOpen(false)}>
            Mangva
          </Link>
          <nav className={`${styles.nav} ${navOpen ? styles.navOpen : ''}`}>
            <Link to="/" className={styles.navLink} onClick={() => setNavOpen(false)}>Catalogue</Link>
            <Link to="/explore" className={styles.navLink} onClick={() => setNavOpen(false)}>Explore</Link>
            <Link to="/library" className={styles.navLink} onClick={() => setNavOpen(false)}>Library</Link>
            <button
              className={`${styles.randomBtn} ${styles.navRandomBtn}`}
              onClick={goRandom}
              disabled={randomizing}
            >
              {randomizing ? '...' : '↺ Random'}
            </button>
          </nav>
        </div>

        <button className={`${styles.randomBtn} ${styles.randomBtnDesktop}`} onClick={goRandom} disabled={randomizing}>
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

      <UpdateBanner />
    </div>
  )
}

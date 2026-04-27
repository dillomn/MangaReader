import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Outlet } from 'react-router-dom'
import { getRandomManga } from '../../services/mangadex'
import styles from './Layout.module.css'

export default function Layout() {
  const navigate = useNavigate()
  const [randomizing, setRandomizing] = useState(false)

  async function goRandom() {
    if (randomizing) return
    setRandomizing(true)
    try {
      const m = await getRandomManga()
      navigate(`/manga/${m.id}`)
    } catch {}
    finally { setRandomizing(false) }
  }

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
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}

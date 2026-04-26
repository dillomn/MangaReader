import { Link } from 'react-router-dom'
import { Outlet } from 'react-router-dom'
import styles from './Layout.module.css'

export default function Layout() {
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
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}

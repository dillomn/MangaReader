import { Link } from 'react-router-dom'
import styles from './NotFound.module.css'

export default function NotFound() {
  return (
    <div className={styles.root}>
      <p className={styles.code}>404</p>
      <h1 className={styles.heading}>Page not found</h1>
      <p className={styles.sub}>This page doesn't exist or was moved.</p>
      <Link to="/" className={styles.btn}>Go to Catalogue</Link>
    </div>
  )
}

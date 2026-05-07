import { useSwUpdate } from '../../hooks/useSwUpdate'
import styles from './UpdateBanner.module.css'

export default function UpdateBanner() {
  const { needsRefresh, refresh } = useSwUpdate()
  if (!needsRefresh) return null

  return (
    <div className={styles.banner}>
      <span className={styles.text}>A new version is available.</span>
      <button className={styles.btn} onClick={refresh}>Refresh</button>
    </div>
  )
}

import { Link } from 'react-router-dom'
import type { Manga } from '../../types'
import styles from './MangaCard.module.css'

interface Props {
  manga: Manga
}

const statusColors: Record<Manga['status'], string> = {
  Ongoing: '#2ecc71',
  Completed: '#3498db',
  Hiatus: '#f39c12',
}

export default function MangaCard({ manga }: Props) {
  return (
    <Link to={`/manga/${manga.id}`} className={styles.card}>
      <div className={styles.cover}>
        <img src={manga.coverUrl} alt={manga.title} />
        <span
          className={styles.status}
          style={{ backgroundColor: statusColors[manga.status] }}
        >
          {manga.status}
        </span>
      </div>
      <div className={styles.info}>
        <h3 className={styles.title}>{manga.title}</h3>
        <p className={styles.author}>{manga.author}</p>
        <div className={styles.genres}>
          {manga.genres.slice(0, 2).map((g) => (
            <span key={g} className={styles.genre}>{g}</span>
          ))}
        </div>
        <p className={styles.chapters}>
          {manga.lastChapter ? `${manga.lastChapter} chapters` : manga.year ? `${manga.year}` : ''}
        </p>
      </div>
    </Link>
  )
}

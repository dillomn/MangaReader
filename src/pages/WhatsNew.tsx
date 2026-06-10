import changelogRaw from '../../CHANGELOG.md?raw'
import styles from './WhatsNew.module.css'

interface ChangelogSection {
  label: string
  items: string[]
}

interface ChangelogVersion {
  version: string
  date: string
  sections: ChangelogSection[]
}

// CHANGELOG.md is the source of truth; it only uses three constructs:
// "## vX.Y.Z — date" headings, "### Features"/"### Fixes" sections, and bullets.
function parseChangelog(md: string): ChangelogVersion[] {
  const versions: ChangelogVersion[] = []
  let version: ChangelogVersion | null = null
  let section: ChangelogSection | null = null

  for (const line of md.split('\n')) {
    const v = line.match(/^## (v\S+) — (.+)$/)
    if (v) {
      version = { version: v[1], date: v[2], sections: [] }
      versions.push(version)
      section = null
      continue
    }
    const s = line.match(/^### (.+)$/)
    if (s && version) {
      section = { label: s[1], items: [] }
      version.sections.push(section)
      continue
    }
    const b = line.match(/^- (.+)$/)
    if (b && section) section.items.push(b[1])
  }
  return versions
}

// Bullets only use **bold** inline markup
function renderInline(text: string) {
  return text.split('**').map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part,
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const VERSIONS = parseChangelog(changelogRaw)

export default function WhatsNew() {
  return (
    <div className={styles.root}>
      <h1 className={styles.heading}>What's New</h1>
      <p className={styles.sub}>Everything that's changed in Mangva, newest first.</p>

      <div className={styles.timeline}>
        {VERSIONS.map((v, i) => (
          <section key={v.version} className={styles.version}>
            <div className={styles.versionHeader}>
              <span className={`${styles.versionBadge} ${i === 0 ? styles.versionBadgeLatest : ''}`}>
                {v.version}
              </span>
              {i === 0 && <span className={styles.latestTag}>Latest</span>}
              <span className={styles.versionDate}>{formatDate(v.date)}</span>
            </div>
            {v.sections.map(s => (
              <div key={s.label} className={styles.section}>
                <span className={s.label === 'Fixes' ? styles.sectionLabelFixes : styles.sectionLabelFeatures}>
                  {s.label}
                </span>
                <ul className={styles.items}>
                  {s.items.map((item, j) => (
                    <li key={j} className={styles.item}>{renderInline(item)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}

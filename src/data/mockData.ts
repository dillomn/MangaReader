import type { Manga } from '../types'

export const mockManga: Manga[] = [
  {
    id: '1',
    title: 'Hollow Blade',
    author: 'Takeshi Ren',
    artist: 'Takeshi Ren',
    coverUrl: 'https://placehold.co/300x420/1a1a2e/e94560?text=Hollow+Blade',
    synopsis:
      'A disgraced swordsman discovers his cursed blade holds the soul of an ancient demon — and together they must stop a war that spans three kingdoms.',
    genres: ['Action', 'Fantasy', 'Adventure'],
    status: 'Ongoing',
    chapters: [
      { id: 'c1', number: 1, title: 'The Broken Oath', uploadedAt: '2024-01-10', pages: 42 },
      { id: 'c2', number: 2, title: 'Blood in the Snow', uploadedAt: '2024-01-24', pages: 38 },
      { id: 'c3', number: 3, title: 'The Demon Speaks', uploadedAt: '2024-02-07', pages: 45 },
      { id: 'c4', number: 4, title: 'Shadow Market', uploadedAt: '2024-02-21', pages: 40 },
    ],
  },
  {
    id: '2',
    title: 'Starfall Academy',
    author: 'Mina Haruki',
    artist: 'Leo Sato',
    coverUrl: 'https://placehold.co/300x420/0f3460/e94560?text=Starfall+Academy',
    synopsis:
      'When ordinary student Yuki receives an acceptance letter from a school that teaches magic through constellations, she must prove she belongs among the stars.',
    genres: ['Fantasy', 'School Life', 'Romance'],
    status: 'Ongoing',
    chapters: [
      { id: 'c1', number: 1, title: 'Letter from the Sky', uploadedAt: '2024-01-05', pages: 36 },
      { id: 'c2', number: 2, title: 'Orientation Night', uploadedAt: '2024-01-19', pages: 34 },
      { id: 'c3', number: 3, title: 'The First Constellation', uploadedAt: '2024-02-02', pages: 38 },
    ],
  },
  {
    id: '3',
    title: 'Iron Hollow',
    author: 'Daisuke Mori',
    artist: 'Aya Kimura',
    coverUrl: 'https://placehold.co/300x420/16213e/e94560?text=Iron+Hollow',
    synopsis:
      'In a post-war world run by mechanized guilds, a scrapper named Rook uncovers a conspiracy buried beneath the city\'s iron foundations.',
    genres: ['Sci-Fi', 'Mystery', 'Action'],
    status: 'Completed',
    chapters: [
      { id: 'c1', number: 1, title: 'The Scrapper', uploadedAt: '2023-06-01', pages: 44 },
      { id: 'c2', number: 2, title: 'Buried Circuit', uploadedAt: '2023-06-15', pages: 41 },
      { id: 'c3', number: 3, title: 'The Guild\'s Eye', uploadedAt: '2023-06-29', pages: 39 },
      { id: 'c4', number: 4, title: 'Rook\'s Gambit', uploadedAt: '2023-07-13', pages: 46 },
      { id: 'c5', number: 5, title: 'Iron City', uploadedAt: '2023-07-27', pages: 52 },
    ],
  },
  {
    id: '4',
    title: 'Tide & Fang',
    author: 'Rei Nozomi',
    artist: 'Rei Nozomi',
    coverUrl: 'https://placehold.co/300x420/0d1b2a/e94560?text=Tide+%26+Fang',
    synopsis:
      'A deep-sea diver and a sea-creature hybrid race against a sinking nation to find the legendary Abyssal Trident before it falls into the wrong hands.',
    genres: ['Adventure', 'Action', 'Supernatural'],
    status: 'Hiatus',
    chapters: [
      { id: 'c1', number: 1, title: 'Below the Surface', uploadedAt: '2024-03-01', pages: 40 },
      { id: 'c2', number: 2, title: 'The Hybrid', uploadedAt: '2024-03-15', pages: 37 },
    ],
  },
  {
    id: '5',
    title: 'Ember Court',
    author: 'Sora Fujita',
    artist: 'Hana Ito',
    coverUrl: 'https://placehold.co/300x420/1b1b2f/e94560?text=Ember+Court',
    synopsis:
      'Political intrigue ignites when a fire-mage is appointed as the new court magician — a role that has claimed the lives of all her predecessors.',
    genres: ['Fantasy', 'Political', 'Drama'],
    status: 'Ongoing',
    chapters: [
      { id: 'c1', number: 1, title: 'The Appointment', uploadedAt: '2024-02-10', pages: 38 },
      { id: 'c2', number: 2, title: 'Ash and Silk', uploadedAt: '2024-02-24', pages: 35 },
      { id: 'c3', number: 3, title: 'The Third Seat', uploadedAt: '2024-03-09', pages: 41 },
    ],
  },
  {
    id: '6',
    title: 'Null Protocol',
    author: 'Kenji Aoba',
    artist: 'Yuki Tanaka',
    coverUrl: 'https://placehold.co/300x420/0a0a0a/e94560?text=Null+Protocol',
    synopsis:
      'A hacker discovers she can rewrite reality\'s source code — but every edit leaves a scar on the physical world.',
    genres: ['Sci-Fi', 'Thriller', 'Cyberpunk'],
    status: 'Ongoing',
    chapters: [
      { id: 'c1', number: 1, title: 'Root Access', uploadedAt: '2024-01-15', pages: 43 },
      { id: 'c2', number: 2, title: 'Overflow', uploadedAt: '2024-01-29', pages: 39 },
      { id: 'c3', number: 3, title: 'Corrupted Node', uploadedAt: '2024-02-12', pages: 44 },
      { id: 'c4', number: 4, title: 'The Null State', uploadedAt: '2024-02-26', pages: 47 },
    ],
  },
]

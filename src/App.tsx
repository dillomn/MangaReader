import { Routes, Route } from 'react-router-dom'
import { DownloadProvider } from './context/DownloadContext'
import Layout from './components/Layout/Layout'
import Catalogue from './pages/Catalogue'
import MangaDetail from './pages/MangaDetail'
import Reader from './pages/Reader'
import Library from './pages/Library'
import Explore from './pages/Explore'

export default function App() {
  return (
    <DownloadProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Catalogue />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/library" element={<Library />} />
          <Route path="/manga/:id" element={<MangaDetail />} />
          <Route path="/manga/:id/chapter/:chapterId" element={<Reader />} />
        </Route>
      </Routes>
    </DownloadProvider>
  )
}

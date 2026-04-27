import { Navigate, Outlet, Routes, Route, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { DownloadProvider } from './context/DownloadContext'
import { ReadProgressProvider } from './context/ReadProgressContext'
import Layout from './components/Layout/Layout'
import Catalogue from './pages/Catalogue'
import MangaDetail from './pages/MangaDetail'
import Reader from './pages/Reader'
import Library from './pages/Library'
import Explore from './pages/Explore'
import Login from './pages/Login'
import Admin from './pages/Admin'

function AuthGuard() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return null

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  return <Outlet />
}

export default function App() {
  return (
    <AuthProvider>
      <ReadProgressProvider>
        <DownloadProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<AuthGuard />}>
              <Route element={<Layout />}>
                <Route index element={<Catalogue />} />
                <Route path="/explore" element={<Explore />} />
                <Route path="/library" element={<Library />} />
                <Route path="/manga/:id" element={<MangaDetail />} />
                <Route path="/manga/:id/chapter/:chapterId" element={<Reader />} />
                <Route path="/admin" element={<Admin />} />
              </Route>
            </Route>
          </Routes>
        </DownloadProvider>
      </ReadProgressProvider>
    </AuthProvider>
  )
}

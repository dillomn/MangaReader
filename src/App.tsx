import { Navigate, Outlet, Routes, Route, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { DownloadProvider } from './context/DownloadContext'
import { ReadProgressProvider } from './context/ReadProgressContext'
import { LibraryProvider } from './context/LibraryContext'
import Layout from './components/Layout/Layout'
import Catalogue from './pages/Catalogue'
import MangaDetail from './pages/MangaDetail'
import Reader from './pages/Reader'
import Library from './pages/Library'
import Explore from './pages/Explore'
import Login from './pages/Login'
import Setup from './pages/Setup'
import Admin from './pages/Admin'
import NotFound from './pages/NotFound'

function SetupGuard() {
  const { loading, setupNeeded } = useAuth()
  const location = useLocation()
  if (loading) return null
  if (setupNeeded && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />
  }
  return <Outlet />
}

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
        <LibraryProvider>
        <DownloadProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="*" element={<NotFound />} />
            <Route element={<SetupGuard />}>
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
            </Route>
          </Routes>
        </DownloadProvider>
        </LibraryProvider>
      </ReadProgressProvider>
    </AuthProvider>
  )
}

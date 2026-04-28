import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getToken, setToken, authFetch } from '../utils/api'

export interface AuthUser {
  id: string
  username: string
  isAdmin: boolean
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  setupNeeded: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  completeSetup: (token: string, user: AuthUser) => void
  authFetch: typeof authFetch
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [setupNeeded, setSetupNeeded] = useState(false)

  useEffect(() => {
    const token = getToken()

    Promise.all([
      fetch('/auth/setup').then(r => r.json()).catch(() => ({ needed: false })),
      token
        ? fetch('/auth/me', { headers: { Authorization: `Bearer ${token}` } })
            .then(async r => { if (r.ok) return r.json(); setToken(null); return null })
            .catch(() => { setToken(null); return null })
        : Promise.resolve(null),
    ]).then(([setup, me]) => {
      setSetupNeeded(setup.needed ?? false)
      if (me) setUser(me)
      setLoading(false)
    })
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error ?? 'Login failed')
    }
    const { token, user: u } = await res.json()
    setToken(token)
    setUser(u)
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  const completeSetup = useCallback((token: string, u: AuthUser) => {
    setToken(token)
    setUser(u)
    setSetupNeeded(false)
  }, [])

  const value = useMemo(
    () => ({ user, loading, setupNeeded, login, logout, completeSetup, authFetch }),
    [user, loading, setupNeeded, login, logout, completeSetup],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

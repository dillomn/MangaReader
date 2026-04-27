import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production'
const JELLYFIN_URL = (process.env.JELLYFIN_URL || 'http://localhost:8096').replace(/\/$/, '')

if (!process.env.JWT_SECRET) {
  console.warn('[auth] WARNING: JWT_SECRET not set — using insecure default. Set it in your environment.')
}
if (!process.env.JELLYFIN_URL) {
  console.warn('[auth] WARNING: JELLYFIN_URL not set — defaulting to http://localhost:8096')
}

export async function validateJellyfinCredentials(username, password) {
  const res = await fetch(`${JELLYFIN_URL}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': 'MediaBrowser Client="MangaReader", Device="Server", DeviceId="mangareader-server", Version="1.0.0"',
    },
    body: JSON.stringify({ Username: username, Pw: password }),
  })

  if (!res.ok) return null

  const data = await res.json()
  return {
    id: data.User.Id,
    username: data.User.Name,
    isAdmin: data.User.Policy?.IsAdministrator ?? false,
  }
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, isAdmin: user.isAdmin },
    JWT_SECRET,
    { expiresIn: '30d' },
  )
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch {
    return null
  }
}

export function extractToken(req) {
  const auth = req.headers['authorization']
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  return null
}

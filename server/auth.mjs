import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { getUserByUsername } from './db.mjs'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production'
const JELLYFIN_URL = (process.env.JELLYFIN_URL || '').replace(/\/$/, '')

export const JELLYFIN_ENABLED = !!process.env.JELLYFIN_URL

if (!process.env.JWT_SECRET) {
  console.warn('[auth] WARNING: JWT_SECRET not set — using insecure default. Set it in your environment.')
}
if (!JELLYFIN_ENABLED) {
  console.warn('[auth] Jellyfin disabled — using local authentication only.')
}

export async function validateJellyfinCredentials(username, password) {
  if (!JELLYFIN_ENABLED) return null
  const res = await fetch(`${JELLYFIN_URL}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': 'MediaBrowser Client="Mangva", Device="Server", DeviceId="mangva-server", Version="1.0.0"',
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

export async function validateLocalCredentials(username, password) {
  const user = getUserByUsername(username)
  if (!user?.passwordHash) return null
  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) return null
  return { id: user.id, username: user.username, isAdmin: user.isAdmin }
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12)
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, isAdmin: user.isAdmin },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '30d' },
  )
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })
  } catch {
    return null
  }
}

export function extractToken(req) {
  const auth = req.headers['authorization']
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  return null
}

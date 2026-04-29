/**
 * JSON-file persistence layer.
 * Stores users, announcements, activity, and pending removals in data/.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)), 'data')
mkdirSync(ROOT, { recursive: true })

const USERS_FILE    = join(ROOT, 'users.json')
const ANNOUNCE_FILE = join(ROOT, 'announcement.json')
const ACTIVITY_FILE = join(ROOT, 'activity.json')
const REMOVALS_FILE = join(ROOT, 'removals.json')

const MAX_DOWNLOADS_PER_USER = 200

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8')
}

// ---- Users ----

export function upsertUser(id, username, isAdmin) {
  const users = readJson(USERS_FILE, {})
  users[id] = {
    ...users[id],
    id,
    username,
    isAdmin,
    lastSeen: new Date().toISOString(),
    createdAt: users[id]?.createdAt ?? new Date().toISOString(),
  }
  writeJson(USERS_FILE, users)
}

export function getUserByUsername(username) {
  const users = readJson(USERS_FILE, {})
  const lower = username.toLowerCase()
  return Object.values(users).find(u => u.username.toLowerCase() === lower) ?? null
}

export function hasAnyAdmin() {
  const users = readJson(USERS_FILE, {})
  return Object.values(users).some(u => u.isAdmin)
}

export function createLocalUser(id, username, passwordHash, isAdmin) {
  const users = readJson(USERS_FILE, {})
  users[id] = {
    id,
    username,
    isAdmin,
    isLocal: true,
    passwordHash,
    lastSeen: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  }
  writeJson(USERS_FILE, users)
}

export function deleteUser(id) {
  const users = readJson(USERS_FILE, {})
  delete users[id]
  writeJson(USERS_FILE, users)

  const activity = readJson(ACTIVITY_FILE, {})
  delete activity[id]
  writeJson(ACTIVITY_FILE, activity)

  const removals = readJson(REMOVALS_FILE, {})
  delete removals[id]
  writeJson(REMOVALS_FILE, removals)
}

export function listUsers() {
  const users = readJson(USERS_FILE, {})
  return Object.values(users)
    .map(({ passwordHash, ...safe }) => safe)
    .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
}

// ---- Activity (downloads) ----

export function recordDownload(userId, username, { mangaId, mangaTitle, coverUrl, chapterId, chapterNumber, chapterTitle }) {
  const activity = readJson(ACTIVITY_FILE, {})
  if (!activity[userId]) activity[userId] = { username, downloads: [] }
  activity[userId].username = username

  activity[userId].downloads = activity[userId].downloads.filter(d => d.chapterId !== chapterId)
  activity[userId].downloads.unshift({
    mangaId, mangaTitle, coverUrl, chapterId, chapterNumber, chapterTitle,
    downloadedAt: new Date().toISOString(),
  })

  if (activity[userId].downloads.length > MAX_DOWNLOADS_PER_USER) {
    activity[userId].downloads = activity[userId].downloads.slice(0, MAX_DOWNLOADS_PER_USER)
  }

  writeJson(ACTIVITY_FILE, activity)
}

// Remove all chapters belonging to a manga for a user.
// Returns the removed chapterIds so the caller can schedule them for local deletion.
export function removeMangaDownloads(userId, mangaId) {
  const activity = readJson(ACTIVITY_FILE, {})
  if (!activity[userId]) return []
  const removed = activity[userId].downloads.filter(d => d.mangaId === mangaId)
  activity[userId].downloads = activity[userId].downloads.filter(d => d.mangaId !== mangaId)
  writeJson(ACTIVITY_FILE, activity)
  return removed.map(d => d.chapterId)
}

export function getAllActivity() {
  return readJson(ACTIVITY_FILE, {})
}

// ---- Pending removals (admin-scheduled, synced to client on next load) ----

export function scheduleRemovals(userId, chapterIds) {
  if (!chapterIds.length) return
  const removals = readJson(REMOVALS_FILE, {})
  if (!removals[userId]) removals[userId] = []
  for (const id of chapterIds) {
    if (!removals[userId].includes(id)) removals[userId].push(id)
  }
  writeJson(REMOVALS_FILE, removals)
}

export function getPendingRemovals(userId) {
  const removals = readJson(REMOVALS_FILE, {})
  return removals[userId] ?? []
}

export function clearRemovals(userId, chapterIds) {
  const removals = readJson(REMOVALS_FILE, {})
  if (!removals[userId]) return
  removals[userId] = removals[userId].filter(id => !chapterIds.includes(id))
  writeJson(REMOVALS_FILE, removals)
}

// ---- Announcements ----

export function getAnnouncement() {
  return readJson(ANNOUNCE_FILE, null)
}

export function setAnnouncement(message) {
  if (!message) {
    writeJson(ANNOUNCE_FILE, null)
    return
  }
  writeJson(ANNOUNCE_FILE, { message, createdAt: new Date().toISOString() })
}

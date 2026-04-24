import type { DownloadInfo } from '../types'

const DB_NAME = 'manga-reader-v1'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages')
      if (!db.objectStoreNames.contains('downloads')) db.createObjectStore('downloads')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function savePage(chapterId: string, index: number, blob: Blob): Promise<void> {
  const db = await getDB()
  const store = db.transaction('pages', 'readwrite').objectStore('pages')
  await wrap(store.put(blob, `${chapterId}-${index}`))
}

export async function getPage(chapterId: string, index: number): Promise<Blob | null> {
  const db = await getDB()
  const store = db.transaction('pages', 'readonly').objectStore('pages')
  const result = await wrap<Blob | undefined>(store.get(`${chapterId}-${index}`))
  return result ?? null
}

export async function setDownloadInfo(chapterId: string, info: DownloadInfo): Promise<void> {
  const db = await getDB()
  const store = db.transaction('downloads', 'readwrite').objectStore('downloads')
  await wrap(store.put(info, chapterId))
}

export async function getDownloadInfo(chapterId: string): Promise<DownloadInfo | null> {
  const db = await getDB()
  const store = db.transaction('downloads', 'readonly').objectStore('downloads')
  const result = await wrap<DownloadInfo | undefined>(store.get(chapterId))
  return result ?? null
}

export async function getAllDownloadInfos(): Promise<Record<string, DownloadInfo>> {
  const db = await getDB()
  const store = db.transaction('downloads', 'readonly').objectStore('downloads')
  return new Promise((resolve, reject) => {
    const result: Record<string, DownloadInfo> = {}
    const req = store.openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (cursor) {
        result[cursor.key as string] = cursor.value as DownloadInfo
        cursor.continue()
      } else {
        resolve(result)
      }
    }
    req.onerror = () => reject(req.error)
  })
}

export async function deleteChapter(chapterId: string, totalPages: number): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['pages', 'downloads'], 'readwrite')
    const pages = tx.objectStore('pages')
    const downloads = tx.objectStore('downloads')
    for (let i = 0; i < totalPages; i++) pages.delete(`${chapterId}-${i}`)
    downloads.delete(chapterId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

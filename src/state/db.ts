/**
 * Minimal IndexedDB wrapper — no dependencies. Stores:
 *  - 'blobs':    assetId → media Blob (survives reloads; media never re-links)
 *  - 'projects': projectId → ProjectRecord (multi-project autosave)
 *  - 'fonts':    family → { family, data: ArrayBuffer } (user-imported fonts)
 */
const DB_NAME = 'cutroom'
const DB_VERSION = 2

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs')
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects')
        if (!db.objectStoreNames.contains('fonts')) db.createObjectStore('fonts')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'))
    })
    dbPromise.catch(() => { dbPromise = null })
  }
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = run(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export const idb = {
  get<T>(store: string, key: string): Promise<T | undefined> {
    return tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>).catch(() => undefined)
  },
  put(store: string, key: string, value: unknown): Promise<void> {
    return tx(store, 'readwrite', (s) => s.put(value, key)).then(() => undefined)
  },
  delete(store: string, key: string): Promise<void> {
    return tx(store, 'readwrite', (s) => s.delete(key)).then(() => undefined).catch(() => undefined)
  },
  getAll<T>(store: string): Promise<T[]> {
    return tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>).catch(() => [])
  },
}

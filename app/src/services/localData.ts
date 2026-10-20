import Dexie from 'dexie'
import { createLocalBackend } from '../data/local/localBackend'
import type { DataBackend } from '../data/repositories'
import { safeGet, safeSet } from './safeStorage'
import { countsOf, totalOf, type Counts } from './migrate'

/** 이 브라우저의 로컬 저장소(IndexedDB)에 데이터가 얼마나 있는지. 로컬 저장소를 쓴 적이 없으면 null(DB를 새로 만들지 않는다). */
export async function localCounts(name = 'lablog'): Promise<Counts | null> {
  try {
    if (!(await Dexie.exists(name))) return null
    const b = createLocalBackend(name)
    try {
      return countsOf(await b.backup.exportAll())
    } finally {
      b.close()
    }
  } catch {
    return null
  }
}

/** 이전 마법사의 원본: 이 브라우저의 로컬 저장소. 다 쓰면 close()를 불러야 한다. */
export function openLocalBackend(name = 'lablog'): DataBackend & { close(): void } {
  return createLocalBackend(name)
}

const key = (userId: string) => `lablog:cloud-migrated:${userId}`
export const migratedAt = (userId: string): string | null => safeGet(key(userId))
export const markMigrated = (userId: string): void => void safeSet(key(userId), new Date().toISOString())

const dismissKey = (userId: string) => `lablog:cloud-migrate-dismissed:${userId}`
export const bannerDismissed = (userId: string): boolean => safeGet(dismissKey(userId)) !== null
export const dismissBanner = (userId: string): void => void safeSet(dismissKey(userId), '1')

export { totalOf }

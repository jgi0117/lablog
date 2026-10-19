import { StorageError } from '../repositories'
import type { Entity, ID, ISODate, NewEntity } from '../../domain/types'

let lastMs = 0

/** 호출할 때마다 반드시 늘어나는 ISO 시각. 같은 밀리초에 저장해도 정렬 순서가 유지된다. */
export function nowIso(): ISODate {
  const ms = Math.max(Date.now(), lastMs + 1)
  lastMs = ms
  return new Date(ms).toISOString()
}

export function newId(): ID {
  return globalThis.crypto.randomUUID()
}

export function makeEntity<T extends Entity>(input: NewEntity<T>): T {
  const at = nowIso()
  return {
    ...input,
    id: input.id ?? newId(),
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    version: 1,
  } as T
}

/** 한글·영문 모두 소문자로 바꾸고 공백을 없앤다. 띄어쓰기가 달라도 부분 일치로 찾기 위함. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '')
}

/** Dexie/IndexedDB 오류를 앱 공통 StorageError로 바꾼다. */
export async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (e) {
    if (e instanceof StorageError) throw e
    const name = e instanceof Error ? e.name : ''
    if (name === 'QuotaExceededError') {
      throw new StorageError('저장 공간이 가득 찼습니다', 'quota')
    }
    if (name === 'SecurityError' || name === 'InvalidStateError' || name === 'OpenFailedError') {
      throw new StorageError('브라우저가 저장을 막았습니다', 'blocked')
    }
    throw e
  }
}

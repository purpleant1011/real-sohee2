import type { IdempotencyStore, KakaoUnlinkPayload } from './types'

/**
 * Creates a deterministic idempotency key for Kakao Unlink event.
 */
export function createUnlinkIdempotencyKey(payload: KakaoUnlinkPayload): string {
  return `kakao:unlink:${payload.appId}:${payload.userId}:${payload.referrerType}`
}

/**
 * In-memory LRU-like idempotency store with bounded capacity to prevent memory leaks.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly keys = new Set<string>()
  private readonly maxEntries: number

  constructor(maxEntries = 5000) {
    this.maxEntries = maxEntries
  }

  has(key: string): boolean {
    return this.keys.has(key)
  }

  set(key: string): void {
    if (this.keys.size >= this.maxEntries) {
      // Remove oldest inserted key
      const oldest = this.keys.values().next().value
      if (oldest !== undefined) {
        this.keys.delete(oldest)
      }
    }
    this.keys.add(key)
  }

  clear(): void {
    this.keys.clear()
  }
}

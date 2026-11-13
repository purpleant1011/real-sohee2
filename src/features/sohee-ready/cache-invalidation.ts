import type { SoheeReadinessSnapshot } from './types';

// In-memory cache registry for edge / server process lifecycle
export const readinessCache = new Map<string, { snapshot: SoheeReadinessSnapshot; cachedAt: number }>();
export const CACHE_TTL_MS = 30_000; // 30 seconds

/**
 * Generates canonical cache key for workspace readiness
 */
export function getReadinessCacheKey(workspaceId: string): string {
  return `readiness:${workspaceId}`;
}

/**
 * HF-03: Invalidate readiness cache for a workspace upon any state transition
 * (e.g. business verified, SNS connected, knowledge confirmed, harness confirmed)
 */
export function invalidateReadinessCache(workspaceId: string): void {
  const cacheKey = getReadinessCacheKey(workspaceId);
  readinessCache.delete(cacheKey);
  console.log(`[sohee-ready] Invalidation executed for workspace: ${workspaceId}`);
}

/**
 * Clears entire cache (for testing and isolation)
 */
export function clearAllReadinessCache(): void {
  readinessCache.clear();
}

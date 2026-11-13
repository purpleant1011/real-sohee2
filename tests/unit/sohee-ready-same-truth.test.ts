import { describe, it, expect, beforeEach } from 'vitest';
import {
  invalidateReadinessCache,
  clearAllReadinessCache,
} from '@/features/sohee-ready/cache-invalidation';
import {
  getCachedSoheeReadiness,
  assertSameReadinessTruth,
} from '@/features/sohee-ready/read-model';

describe('HF-03: Readiness Same-Truth & Cache Invalidation Guard', () => {
  const workspaceId = 'ws-ig-only';

  beforeEach(() => {
    clearAllReadinessCache();
  });

  it('proves Owner, Admin, and Agent runtime observe the exact same readiness truth', async () => {
    const result = await assertSameReadinessTruth(workspaceId);
    expect(result.isSameTruth).toBe(true);
    expect(result.ownerSnapshot.ready).toBe(false);
    expect(result.adminSnapshot.ready).toBe(false);
    expect(result.agentSnapshot.ready).toBe(false);
    expect(result.ownerSnapshot.blockers).toEqual(result.adminSnapshot.blockers);
    expect(result.adminSnapshot.blockers).toEqual(result.agentSnapshot.blockers);
  });

  it('invalidates cache deterministically and re-evaluates fresh state', async () => {
    // 1. Initial read caches state (missing threads)
    const initial = await getCachedSoheeReadiness(workspaceId);
    expect(initial.ready).toBe(false);

    // 2. Invalidate cache upon state transition
    invalidateReadinessCache(workspaceId);

    // 3. Next read reflects the updated state without stale cache
    const fresh = await getCachedSoheeReadiness(workspaceId, {
      fixtureState: { THREADS_VERIFIED: true },
      forceFresh: true,
    });
    // With Threads verified, now ready is true (for ws-ig-only where only Threads was missing)
    expect(fresh.ready).toBe(true);
    expect(fresh.blockers).toHaveLength(0);
  });
});

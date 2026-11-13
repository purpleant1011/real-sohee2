import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyExternalActionReadback } from '../external-verification-engine';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

import { createServerSupabaseClient } from '@/lib/supabase/server';

describe('External Verification Engine Fail-Closed Guard (ANI-704, ANI-750)', () => {
  let mockUpsert: ReturnType<typeof vi.fn>;
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsert = vi.fn().mockResolvedValue({ error: null });
    mockSupabase = {
      from: vi.fn().mockReturnValue({
        upsert: mockUpsert,
      }),
    };
    vi.mocked(createServerSupabaseClient).mockResolvedValue(mockSupabase);
  });

  it('fails closed when workspaceId is missing', async () => {
    const result = await verifyExternalActionReadback({
      providerResult: { status: 200, temporaryPostId: 'tmp-1' },
      readbackChecker: async () => ({
        isLive: true,
        permalink: 'https://instagram.com/p/valid_post_1',
        authoritativeId: 'auth-1',
      }),
    });

    expect(result.isVerified).toBe(false);
    expect(result.status).toBe('VERIFY_FAILED');
    expect(result.errorReason).toContain('workspaceId is required');
  });

  it('rejects when provider HTTP status is not 2xx', async () => {
    const result = await verifyExternalActionReadback({
      workspaceId: 'ws-test-1',
      providerResult: { status: 500 },
      readbackChecker: async () => ({ isLive: false }),
    });

    expect(result.isVerified).toBe(false);
    expect(result.status).toBe('PROVIDER_REJECTED');
  });

  it('rejects fake/placeholder permalinks in production', async () => {
    const result = await verifyExternalActionReadback({
      workspaceId: 'ws-test-1',
      channel: 'instagram',
      providerResult: { status: 200 },
      readbackChecker: async () => ({
        isLive: true,
        permalink: 'https://example.com/fake-post/123',
        authoritativeId: 'auth-1',
      }),
    });

    expect(result.isVerified).toBe(false);
    expect(result.status).toBe('VERIFY_FAILED');
    expect(result.errorReason).toContain('Mock/Placeholder permalinks are prohibited');
  });

  it('rejects invalid channel hostname (e.g. twitter for instagram channel)', async () => {
    const result = await verifyExternalActionReadback({
      workspaceId: 'ws-test-1',
      channel: 'instagram',
      providerResult: { status: 200 },
      readbackChecker: async () => ({
        isLive: true,
        permalink: 'https://twitter.com/p/12345',
        authoritativeId: 'auth-1',
      }),
    });

    expect(result.isVerified).toBe(false);
    expect(result.status).toBe('VERIFY_FAILED');
    expect(result.errorReason).toContain('Invalid channel permalink');
  });

  it('fails closed to RESULT_UNKNOWN_RECONCILE_REQUIRED when DB receipt persistence fails (ANI-704)', async () => {
    mockUpsert.mockResolvedValue({
      error: { message: 'Database constraint violation or disk full' },
    });

    const result = await verifyExternalActionReadback({
      workspaceId: 'ws-test-1',
      channel: 'instagram',
      contentBody: 'Test marketing copy',
      providerResult: { status: 200 },
      readbackChecker: async () => ({
        isLive: true,
        permalink: 'https://instagram.com/p/real_post_999',
        authoritativeId: 'inst_real_999',
      }),
    });

    expect(result.isVerified).toBe(false);
    expect(result.status).toBe('RESULT_UNKNOWN_RECONCILE_REQUIRED');
    expect(result.errorReason).toContain('Receipt persistence failed');
  });

  it('certifies VERIFIED_CANONICAL and returns receipt when readback and DB upsert succeed', async () => {
    mockUpsert.mockResolvedValue({ error: null });

    const result = await verifyExternalActionReadback({
      workspaceId: 'ws-test-1',
      channel: 'instagram',
      contentBody: 'Verified autumn care promotion',
      providerResult: { status: 200 },
      readbackChecker: async () => ({
        isLive: true,
        permalink: 'https://instagram.com/p/autumn_promo_100',
        authoritativeId: 'meta_obj_100',
      }),
    });

    expect(result.isVerified).toBe(true);
    expect(result.status).toBe('VERIFIED_CANONICAL');
    expect(result.receipt).toBeDefined();
    expect(result.receipt?.externalUrl).toBe('https://instagram.com/p/autumn_promo_100');
    expect(result.receipt?.providerObjectId).toBe('meta_obj_100');
    expect(mockUpsert).toHaveBeenCalled();
  });
});

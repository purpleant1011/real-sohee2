import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentSessionService } from '@/features/agent-session/agent-session-service';
import { CanonicalSurfaceContext } from '@/features/agent-session/types';

const dbSessionStore = new Map<string, any>();

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === 'conversation_threads') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: {
                  id: '00000000-0000-4000-8000-000000000101',
                  workspace_id: 'ws-test-byreum',
                  title: 'Mock Thread',
                  kind: 'operations',
                  status: 'active',
                  model_profile: 'conversation_gpt_5_6_luna_max',
                  last_message_at: new Date().toISOString(),
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
                error: null,
              })),
            })),
          })),
        };
      }
      return {
        upsert: vi.fn(async (record: any) => {
          dbSessionStore.set(`${record.workspace_id}:${record.session_id}`, record);
          return { error: null };
        }),
        select: vi.fn(() => ({
          eq: vi.fn((col1: string, val1: string) => ({
            eq: vi.fn((col2: string, val2: string) => ({
              maybeSingle: vi.fn(async () => {
                const item = dbSessionStore.get(`${val1}:${val2}`);
                return { data: item || null, error: null };
              }),
            })),
          })),
        })),
      };
    }),
  })),
}));

describe('ANI-918: Durable Agent Session & Thread Persistence SSOT', () => {
  const WORKSPACE_A = 'ws-test-byreum';
  const WORKSPACE_B = 'ws-other-clinic';

  beforeEach(() => {
    dbSessionStore.clear();
    AgentSessionService.resetMemoryStoreForTesting();
  });

  it('creates a new canonical session with monotonic version 1 and ACTIVE status when no sessionId provided', async () => {
    const surface: CanonicalSurfaceContext = {
      route: '/app/customers',
      routeName: 'customers',
      selectedItemId: 'cust-9988',
      entityType: 'customer',
    };

    const result = await AgentSessionService.resolveOrCreateSession({
      workspaceId: WORKSPACE_A,
      surface,
      deviceChannel: 'desktop',
    });

    expect(result.isNewSession).toBe(true);
    expect(result.reconnected).toBe(false);
    expect(result.session.sessionId).toMatch(/^ses_\d+_/);
    expect(result.session.threadId).toBeDefined();
    expect(result.session.snapshotVersion).toBe(1);
    expect(result.session.status).toBe('ACTIVE');
    expect(result.session.currentSurface.route).toBe('/app/customers');
    expect(result.session.currentSurface.selectedItemId).toBe('cust-9988');
  });

  it('resolves existing session, preserving sessionId and threadId across requests (session continuity)', async () => {
    // 1. Initial creation
    const initial = await AgentSessionService.resolveOrCreateSession({
      workspaceId: WORKSPACE_A,
      surface: { route: '/app/customers', routeName: 'customers' },
    });

    const sessionId = initial.session.sessionId;
    const threadId = initial.session.threadId;

    // 2. Reconnect with existing sessionId
    const reconnected = await AgentSessionService.resolveOrCreateSession({
      workspaceId: WORKSPACE_A,
      sessionId,
    });

    expect(reconnected.isNewSession).toBe(false);
    expect(reconnected.reconnected).toBe(true);
    expect(reconnected.session.sessionId).toBe(sessionId);
    expect(reconnected.session.threadId).toBe(threadId);
  });

  it('updates surface context on route change (/app/customers -> /app/content) while strictly maintaining session and thread identity', async () => {
    // Step 1: User is at /app/customers inspecting customer 'cust-42'
    const step1 = await AgentSessionService.resolveOrCreateSession({
      workspaceId: WORKSPACE_A,
      surface: {
        route: '/app/customers',
        routeName: 'customers',
        selectedItemId: 'cust-42',
        entityType: 'customer',
      },
    });

    const sessionId = step1.session.sessionId;
    const threadId = step1.session.threadId;
    expect(step1.session.snapshotVersion).toBe(1);

    // Step 2: User navigates to /app/content with calendar tab
    const step2 = await AgentSessionService.updateSurface({
      workspaceId: WORKSPACE_A,
      sessionId,
      surface: {
        route: '/app/content',
        routeName: 'content',
        tab: 'calendar',
        selectedItemId: undefined,
      },
    });

    expect(step2.session.sessionId).toBe(sessionId);
    expect(step2.session.threadId).toBe(threadId);
    expect(step2.session.currentSurface.route).toBe('/app/content');
    expect(step2.session.currentSurface.tab).toBe('calendar');
    expect(step2.session.snapshotVersion).toBe(2);
    expect(step2.mismatchDetected).toBe(false);

    // Step 3: Fetch session from store confirms updated surface and version
    const fetched = await AgentSessionService.getSession(WORKSPACE_A, sessionId);
    expect(fetched?.currentSurface.route).toBe('/app/content');
    expect(fetched?.snapshotVersion).toBe(2);
  });

  it('detects snapshot mismatch when client sends stale expectedVersion', async () => {
    const sessionRes = await AgentSessionService.resolveOrCreateSession({
      workspaceId: WORKSPACE_A,
      surface: { route: '/app' },
    });

    const sessionId = sessionRes.session.sessionId;

    // First surface update bumps version to 2
    await AgentSessionService.updateSurface({
      workspaceId: WORKSPACE_A,
      sessionId,
      surface: { route: '/app/ads' },
    });

    // Client attempts update passing expectedVersion = 1 (stale)
    const staleUpdate = await AgentSessionService.updateSurface({
      workspaceId: WORKSPACE_A,
      sessionId,
      surface: { route: '/app/results' },
      expectedVersion: 1,
    });

    expect(staleUpdate.mismatchDetected).toBe(true);
    expect(staleUpdate.session.snapshotVersion).toBe(3);
    expect(staleUpdate.session.currentSurface.route).toBe('/app/results');
  });

  it('transitions session status to AWAITING_APPROVAL and back to ACTIVE on approval resume', async () => {
    const sessionRes = await AgentSessionService.resolveOrCreateSession({
      workspaceId: WORKSPACE_A,
    });
    const sessionId = sessionRes.session.sessionId;

    // Agent reaches human approval gate
    const pendingApproval = await AgentSessionService.setSessionStatus(
      WORKSPACE_A,
      sessionId,
      'AWAITING_APPROVAL'
    );
    expect(pendingApproval?.status).toBe('AWAITING_APPROVAL');
    expect(pendingApproval?.snapshotVersion).toBe(2);

    // Owner approves, resuming ACTIVE session
    const resumed = await AgentSessionService.setSessionStatus(
      WORKSPACE_A,
      sessionId,
      'ACTIVE'
    );
    expect(resumed?.status).toBe('ACTIVE');
    expect(resumed?.snapshotVersion).toBe(3);
  });

  it('enforces multi-tenant isolation so sessions cannot be accessed across workspaces', async () => {
    const resA = await AgentSessionService.resolveOrCreateSession({
      workspaceId: WORKSPACE_A,
      surface: { route: '/app/customers' },
    });

    // Attempting to get workspace A's session using workspace B
    const leakedSession = await AgentSessionService.getSession(WORKSPACE_B, resA.session.sessionId);
    expect(leakedSession).toBeNull();
  });
});

/**
 * Canonical Agent Session Service (ANI-918, ANI-939)
 * 
 * Provides durable session resolution, surface state tracking, and thread continuity.
 * Eliminates browser-only split-brain and ensures route switching preserves agent context.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { ConversationRepository } from '@/lib/conversation/conversation-repository';
import {
  CanonicalAgentSession,
  CanonicalSurfaceContext,
  ResolveSessionParams,
  SessionResolutionResult,
  AgentSessionStatus,
  UpdateSurfaceParams,
} from './types';
import { PersistenceError } from '@/lib/errors/persistence-error';

// In-memory durable cache for multi-turn execution and serverless fast-lookup / testing
const sessionMemoryStore = new Map<string, CanonicalAgentSession>();

function makeSessionKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}:${sessionId}`;
}

export class AgentSessionService {
  /**
   * Reset in-memory cache (primarily for unit tests)
   */
  public static resetMemoryStoreForTesting(): void {
    sessionMemoryStore.clear();
  }

  /**
   * Resolves an existing agent session or creates a new canonical session.
   * Ensures thread persistence across navigation and page reload.
   */
  public static async resolveOrCreateSession(
    params: ResolveSessionParams
  ): Promise<SessionResolutionResult> {
    const {
      workspaceId,
      sessionId,
      threadId: preferredThreadId,
      surface,
      deviceChannel = 'desktop',
      correlationId: incomingCorrelationId,
    } = params;

    const initialSurface: CanonicalSurfaceContext = surface || { route: '/app' };

    // 1. Attempt to resolve existing session if sessionId provided
    if (sessionId) {
      const existing = await this.getSession(workspaceId, sessionId);
      if (existing) {
        let needsUpdate = false;
        let nextVersion = existing.snapshotVersion;

        // If surface changed, update surface context
        if (surface && JSON.stringify(surface) !== JSON.stringify(existing.currentSurface)) {
          existing.currentSurface = { ...existing.currentSurface, ...surface };
          nextVersion += 1;
          needsUpdate = true;
        }

        // If thread specified and differs, update thread
        if (preferredThreadId && preferredThreadId !== existing.threadId) {
          existing.threadId = preferredThreadId;
          needsUpdate = true;
        }

        if (needsUpdate) {
          existing.snapshotVersion = nextVersion;
          existing.updatedAt = new Date().toISOString();
          await this.persistSession(existing);
        }

        return {
          session: existing,
          isNewSession: false,
          reconnected: true,
        };
      }
    }

    // 2. Create new durable session
    const newSessionId = sessionId || `ses_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const correlationId = incomingCorrelationId || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Resolve or create thread (Fail-Closed, zero synthetic fallback)
    let activeThreadId = preferredThreadId;
    if (!activeThreadId) {
      const createdThread = await ConversationRepository.createThread(
        workspaceId,
        `세션 ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`
      );
      if (!createdThread?.id) {
        throw new PersistenceError('resolveOrCreateSession', 'Failed to create canonical thread for session');
      }
      activeThreadId = createdThread.id;
    }

    const isUUID = (val?: string) =>
      typeof val === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);

    if (!isUUID(activeThreadId)) {
      throw new PersistenceError('resolveOrCreateSession', `Invalid non-UUID threadId: ${activeThreadId}`);
    }

    const newSession: CanonicalAgentSession = {
      id: crypto.randomUUID(),
      workspaceId,
      sessionId: newSessionId,
      threadId: activeThreadId,
      currentSurface: initialSurface,
      correlationId,
      snapshotVersion: 1,
      deviceChannel,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.persistSession(newSession);

    return {
      session: newSession,
      isNewSession: true,
      reconnected: false,
    };
  }

  /**
   * Retrieves a session by workspaceId and sessionId
   */
  public static async getSession(
    workspaceId: string,
    sessionId: string
  ): Promise<CanonicalAgentSession | null> {
    const memKey = makeSessionKey(workspaceId, sessionId);
    const cached = sessionMemoryStore.get(memKey);
    if (cached) return cached;

    // Database lookup
    try {
      const supabase = await createServerSupabaseClient();
      const db = supabase as any;
      const { data, error } = await db
        .from('agent_sessions')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('session_id', sessionId)
        .maybeSingle();

      if (!error && data) {
        const session: CanonicalAgentSession = {
          id: data.id,
          workspaceId: data.workspace_id,
          sessionId: data.session_id,
          threadId: data.thread_id,
          conversationId: data.conversation_id,
          currentSurface: (data.current_surface as CanonicalSurfaceContext) || { route: '/app' },
          correlationId: data.correlation_id || data.session_id,
          snapshotVersion: data.snapshot_version || 1,
          deviceChannel: data.device_channel || 'desktop',
          status: data.status || 'ACTIVE',
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        };
        sessionMemoryStore.set(memKey, session);
        return session;
      }
    } catch {
      // Ignore DB errors in offline/test env
    }

    return null;
  }

  /**
   * Updates the surface context of an active session.
   * Detects client/server snapshot mismatch if expectedVersion is provided.
   */
  public static async updateSurface(
    params: UpdateSurfaceParams
  ): Promise<{ session: CanonicalAgentSession; mismatchDetected: boolean }> {
    const { workspaceId, sessionId, surface, expectedVersion } = params;
    const session = await this.getSession(workspaceId, sessionId);

    if (!session) {
      // If session doesn't exist, create one
      const res = await this.resolveOrCreateSession({
        workspaceId,
        sessionId,
        surface,
      });
      return { session: res.session, mismatchDetected: false };
    }

    const mismatchDetected =
      expectedVersion !== undefined && expectedVersion !== session.snapshotVersion;

    session.currentSurface = {
      ...session.currentSurface,
      ...surface,
    };
    session.snapshotVersion += 1;
    session.updatedAt = new Date().toISOString();

    await this.persistSession(session);

    return { session, mismatchDetected };
  }

  /**
   * Transitions the session status (e.g., ACTIVE, AWAITING_APPROVAL, PAUSED, CLOSED)
   */
  public static async setSessionStatus(
    workspaceId: string,
    sessionId: string,
    status: AgentSessionStatus
  ): Promise<CanonicalAgentSession | null> {
    const session = await this.getSession(workspaceId, sessionId);
    if (!session) return null;

    session.status = status;
    session.snapshotVersion += 1;
    session.updatedAt = new Date().toISOString();

    await this.persistSession(session);
    return session;
  }

  /**
   * Internal helper to persist session to database and fast cache.
   * Enforces Fail-Closed: throws PersistenceError on failure and does not update memory cache.
   */
  private static async persistSession(session: CanonicalAgentSession): Promise<void> {
    try {
      const supabase = await createServerSupabaseClient();
      const { error } = await (supabase as any)
        .from('agent_sessions')
        .upsert(
          {
            workspace_id: session.workspaceId,
            session_id: session.sessionId,
            thread_id: session.threadId,
            conversation_id: session.conversationId,
            current_surface: session.currentSurface,
            correlation_id: session.correlationId,
            snapshot_version: session.snapshotVersion,
            device_channel: session.deviceChannel,
            status: session.status,
            updated_at: session.updatedAt,
          },
          { onConflict: 'workspace_id,session_id' }
        );

      if (error) {
        console.error('[AgentSessionService] Failed to persist session to DB:', error);
        throw new PersistenceError('persistSession', error.message || 'Failed to persist session to DB', error);
      }

      const memKey = makeSessionKey(session.workspaceId, session.sessionId);
      sessionMemoryStore.set(memKey, { ...session });
    } catch (err) {
      if (err instanceof PersistenceError) {
        throw err;
      }
      console.error('[AgentSessionService] Error persisting session:', err);
      throw new PersistenceError('persistSession', (err as Error).message || 'Unexpected error persisting session', err);
    }
  }
}


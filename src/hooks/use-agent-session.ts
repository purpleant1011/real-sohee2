'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { CanonicalAgentSession, CanonicalSurfaceContext } from '@/features/agent-session/types';
import { useSurfaceContext } from '@/features/agent-dock/surface-context';
import { useOptionalWorkspaceContext } from '@/hooks/use-workspace-context';

export function useAgentSession(customWorkspaceId?: string) {
  const workspaceContext = useOptionalWorkspaceContext();
  const workspaceId = (customWorkspaceId && customWorkspaceId !== 'ws-default')
    ? customWorkspaceId
    : (workspaceContext?.workspaceId || '');

  const { context } = useSurfaceContext();
  const [session, setSession] = useState<CanonicalAgentSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mismatchDetected, setMismatchDetected] = useState(false);
  const lastSyncedSurfaceRef = useRef<string>('');

  // 1. Initialize or restore session on mount
  useEffect(() => {
    if (!workspaceId || workspaceId === 'ws-default') {
      setIsLoading(false);
      return;
    }
    let isMounted = true;
    const storageKey = `sohee:agent_session:${workspaceId}`;
    const storedSessionId =
      typeof window !== 'undefined'
        ? sessionStorage.getItem(storageKey) || localStorage.getItem(storageKey)
        : null;

    async function initSession() {
      try {
        setIsLoading(true);
        const currentSurface: CanonicalSurfaceContext = {
          route: context.route,
          routeName: context.routeName,
          tab: context.tab,
          selectedItemId: context.selectedItemId,
          entityType: context.entityType,
        };

        const res = await fetch(`/api/workspaces/${workspaceId}/agent/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: storedSessionId || undefined,
            surface: currentSurface,
          }),
        });

        if (!res.ok) throw new Error(`Failed to resolve session: ${res.status}`);
        const data = await res.json();

        if (isMounted && data.session) {
          setSession(data.session);
          if (typeof window !== 'undefined') {
            sessionStorage.setItem(storageKey, data.session.sessionId);
            localStorage.setItem(storageKey, data.session.sessionId);
          }
          lastSyncedSurfaceRef.current = JSON.stringify(currentSurface);
        }
      } catch (err) {
        console.warn('[useAgentSession] Error initializing session:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    initSession();

    return () => {
      isMounted = false;
    };
  }, [workspaceId]);

  // 2. Sync surface changes (e.g. navigation from /app/customers to /app/content)
  useEffect(() => {
    if (!session || isLoading) return;

    const currentSurface: CanonicalSurfaceContext = {
      route: context.route,
      routeName: context.routeName,
      tab: context.tab,
      selectedItemId: context.selectedItemId,
      entityType: context.entityType,
    };

    const surfaceKey = JSON.stringify(currentSurface);
    if (surfaceKey === lastSyncedSurfaceRef.current) return;

    const timeoutId = setTimeout(async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/agent/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update_surface',
            sessionId: session.sessionId,
            surface: currentSurface,
            expectedVersion: session.snapshotVersion,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.session) {
            setSession(data.session);
            setMismatchDetected(!!data.mismatchDetected);
            lastSyncedSurfaceRef.current = surfaceKey;
          }
        }
      } catch (err) {
        console.warn('[useAgentSession] Failed to sync surface:', err);
      }
    }, 150);

    return () => clearTimeout(timeoutId);
  }, [context, session, isLoading, workspaceId]);

  const refreshSession = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agent/session?sessionId=${session.sessionId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.session) setSession(data.session);
      }
    } catch {}
  }, [session, workspaceId]);

  return {
    session,
    sessionId: session?.sessionId || null,
    threadId: session?.threadId || null,
    currentSurface: session?.currentSurface || null,
    isLoading,
    mismatchDetected,
    refreshSession,
  };
}

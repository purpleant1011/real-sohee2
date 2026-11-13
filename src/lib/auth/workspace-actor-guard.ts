import { NextRequest, NextResponse } from 'next/server';
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface VerifiedWorkspaceActor {
  actorId: string;
  role: string;
  workspaceId: string;
  isTestAccount: boolean;
  datasetMode: 'ACTUAL' | 'CANARY' | 'TEST';
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = '인증이 필요합니다. 로그인 후 다시 시도해 주세요.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = '해당 작업공간에 대한 접근 권한이 없습니다.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export interface SecurityAuditEvent {
  eventType: 'UNAUTHORIZED_TEST_BYPASS_ATTEMPT' | string;
  workspaceId: string;
  actorId?: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

type SecurityAuditListener = (event: SecurityAuditEvent) => void;
const auditListeners = new Set<SecurityAuditListener>();

export function onSecurityAuditEvent(listener: SecurityAuditListener): () => void {
  auditListeners.add(listener);
  return () => {
    auditListeners.delete(listener);
  };
}

export async function emitSecurityAuditEvent(event: SecurityAuditEvent): Promise<void> {
  console.warn(
    `[SECURITY AUDIT] ${event.eventType} on workspace ${event.workspaceId}:`,
    redactSecrets(event.metadata)
  );

  for (const listener of auditListeners) {
    try {
      listener(event);
    } catch (e) {
      console.error('[SecurityAudit] Listener error:', e);
    }
  }

  try {
    const supabase = await createServerSupabaseClient().catch(() => null);
    if (supabase) {
      await (supabase as any).from('audit_events').insert({
        workspace_id: event.workspaceId,
        actor_id: event.actorId || null,
        entity_type: 'security_guard',
        entity_id: event.workspaceId,
        event_type: event.eventType,
        created_at: event.timestamp,
        metadata: redactSecrets(event.metadata),
      });
    }
  } catch (err) {
    console.error('[SecurityAudit] Failed to persist audit event to DB:', err);
  }
}

export function isTestWorkspace(workspaceId: string): boolean {
  if (!workspaceId) return false;
  const lower = workspaceId.toLowerCase();
  return (
    lower === 'ws-test-byreum' ||
    lower === 'ws-demo-byreum' ||
    lower === 'ws-test' ||
    lower === 'ws-demo' ||
    lower.startsWith('ws-test-') ||
    lower.startsWith('ws-demo-') ||
    lower.startsWith('d1000000-')
  );
}

const SENSITIVE_KEY_PATTERNS = new Set([
  'password',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'cookie',
  'authorization',
  'apikey',
  'clientsecret',
  'session',
  'auth',
  'githubtoken',
  'invitelink',
  'recoverycode',
  'exactpayload',
  'providerbody',
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function redactSensitiveString(text: string): string {
  return text
    .replace(/(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/gi, '$1[REDACTED]$3')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|sb_secret_[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_-]+|xoxb-[A-Za-z0-9_-]+)\b/gi, '[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9_\-\.]+\b/gi, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]');
}

export function redactSecrets<T = unknown>(value: T, depth = 0, ancestors = new WeakSet<object>()): T {
  if (depth > 6) return '[LIMIT_EXCEEDED]' as unknown as T;
  if (value === undefined || value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return redactSensitiveString(value) as unknown as T;
  }
  if (value instanceof Error) {
    return redactSensitiveString(value.message) as unknown as T;
  }
  if (typeof value !== 'object') {
    return '[UNAVAILABLE]' as unknown as T;
  }
  if (ancestors.has(value as object)) {
    return '[CIRCULAR]' as unknown as T;
  }

  if (Array.isArray(value)) {
    ancestors.add(value);
    try {
      return value.map((item) => redactSecrets(item, depth + 1, ancestors)) as unknown as T;
    } finally {
      ancestors.delete(value);
    }
  }

  ancestors.add(value as object);
  const result: Record<string, unknown> = {};
  try {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val === undefined) continue;
      const normalized = normalizeKey(key);
      if (SENSITIVE_KEY_PATTERNS.has(normalized) || normalized.includes('secret') || normalized.includes('token') || normalized.includes('key')) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactSecrets(val, depth + 1, ancestors);
      }
    }
    return result as unknown as T;
  } finally {
    ancestors.delete(value as object);
  }
}

export function redactErrorPayload(error: unknown): string {
  if (error instanceof Error) {
    return redactSensitiveString(error.message);
  }
  if (typeof error === 'string') {
    return redactSensitiveString(error);
  }
  return redactSensitiveString(JSON.stringify(redactSecrets(error)));
}

export function stripClientBypassFlags(body: any, isActual: boolean): void {
  if (body && typeof body === 'object') {
    if (isActual) {
      delete body.isTestAccount;
      delete body.noCharge;
      delete body.datasetMode;
      delete body.dataset_mode;
    }
  }
}

/**
 * Server-authoritative workspace actor guard (ANI-982, ANI-983, ANI-984, ANI-985)
 * 
 * Verifies that the requesting actor has active membership in targetWorkspaceId.
 * Eliminates client-side bypasses (tampering with isTestAccount, noCharge, datasetMode).
 * Fails closed with UnauthorizedError (401) or ForbiddenError (403).
 */
export async function verifyWorkspaceActor(
  req: NextRequest,
  targetWorkspaceId: string,
  optionsOrBody?: { body?: any; supabase?: any } | Record<string, any>
): Promise<VerifiedWorkspaceActor> {
  if (!targetWorkspaceId || typeof targetWorkspaceId !== 'string' || !targetWorkspaceId.trim()) {
    throw new ForbiddenError('유효한 작업공간 식별자가 필요합니다.');
  }

  const cleanWsId = targetWorkspaceId.trim();

  // 1. Authenticate & Authorize via Server-Authoritative Membership SSOT
  const authResult = await requireWorkspaceMembership(cleanWsId);
  if (!authResult.ok) {
    if (authResult.status === 401) {
      throw new UnauthorizedError(authResult.message || '인증이 필요합니다.');
    }
    throw new ForbiddenError(authResult.message || '해당 작업공간에 대한 접근 권한이 없습니다.');
  }

  // 2. Server-Authoritative Dataset Mode & Test Account Determination
  const isTestWs = isTestWorkspace(cleanWsId);
  let datasetMode: 'ACTUAL' | 'CANARY' | 'TEST' = 'ACTUAL';
  let isTestAccount = false;

  if (isTestWs || authResult.email === 'test@example.com') {
    datasetMode = 'TEST';
    isTestAccount = true;
  } else if (cleanWsId.toLowerCase().startsWith('ws-canary-')) {
    datasetMode = 'CANARY';
    isTestAccount = false;
  } else {
    datasetMode = 'ACTUAL';
    isTestAccount = false;
  }

  // 3. Detect and neutralize client spoofing attempts
  let clientBody: any = null;
  if (optionsOrBody && typeof optionsOrBody === 'object') {
    if ('body' in optionsOrBody && typeof (optionsOrBody as any).body === 'object' && (optionsOrBody as any).body !== null) {
      clientBody = (optionsOrBody as any).body;
    } else {
      clientBody = optionsOrBody;
    }
  } else if (req && req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      clientBody = await req.clone().json().catch(() => null);
    } catch {
      // ignore
    }
  }

  if (clientBody && typeof clientBody === 'object') {
    const hasSpoofedFlags = Boolean(
      clientBody.isTestAccount === true ||
      clientBody.noCharge === true ||
      clientBody.datasetMode === 'TEST' ||
      clientBody.dataset_mode === 'TEST' ||
      (clientBody.userEmail && clientBody.userEmail.toLowerCase() === 'test@example.com' && datasetMode === 'ACTUAL')
    );

    if (datasetMode === 'ACTUAL') {
      if (hasSpoofedFlags) {
        await emitSecurityAuditEvent({
          eventType: 'UNAUTHORIZED_TEST_BYPASS_ATTEMPT',
          workspaceId: cleanWsId,
          actorId: authResult.userId,
          timestamp: new Date().toISOString(),
          metadata: {
            attemptedFlags: {
              isTestAccount: clientBody.isTestAccount,
              noCharge: clientBody.noCharge,
              datasetMode: clientBody.datasetMode || clientBody.dataset_mode,
              userEmail: clientBody.userEmail,
            },
            reason: 'Client attempted to spoof isTestAccount or test flags on an ACTUAL workspace',
          },
        });
      }

      // Neutralize client-side bypass flags strictly
      stripClientBypassFlags(clientBody, true);
      isTestAccount = false;
    }
  }

  return {
    actorId: authResult.userId,
    role: authResult.role || 'member',
    workspaceId: cleanWsId,
    isTestAccount,
    datasetMode,
  };
}

export function handleWorkspaceActorError(err: unknown): NextResponse | null {
  if (err instanceof UnauthorizedError || (err as any)?.status === 401) {
    return NextResponse.json(
      {
        success: false,
        error: 'UNAUTHORIZED',
        message: err instanceof Error ? err.message : '인증이 필요합니다.',
      },
      { status: 401 }
    );
  }
  if (err instanceof ForbiddenError || (err as any)?.status === 403) {
    return NextResponse.json(
      {
        success: false,
        error: 'FORBIDDEN',
        message: err instanceof Error ? err.message : '해당 작업공간에 대한 접근 권한이 없습니다.',
      },
      { status: 403 }
    );
  }
  return null;
}

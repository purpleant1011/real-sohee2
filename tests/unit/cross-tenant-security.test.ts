import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  verifyWorkspaceActor,
  redactSecrets,
  redactErrorPayload,
  UnauthorizedError,
  ForbiddenError,
  onSecurityAuditEvent,
  type SecurityAuditEvent,
} from '@/lib/auth/workspace-actor-guard';
import * as workspaceGuard from '@/lib/auth/workspace-guard';
import { AgentOrchestrator } from '@/lib/agent-os/agent-orchestrator';
import { ConversationRepository } from '@/lib/conversation/conversation-repository';
import { AgentSessionService } from '@/features/agent-session/agent-session-service';
import { POST as chatPost, GET as chatGet } from '@/app/api/workspaces/[workspaceId]/agent/chat/route';
import { POST as sessionPost, GET as sessionGet } from '@/app/api/workspaces/[workspaceId]/agent/session/route';

vi.mock('@/lib/auth/workspace-guard');
vi.mock('@/lib/agent-os/agent-orchestrator', () => ({
  AgentOrchestrator: {
    executeTurn: vi.fn(),
  },
}));
vi.mock('@/lib/conversation/conversation-repository', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/conversation/conversation-repository')>(),
  ConversationRepository: {
    getThreads: vi.fn(),
    getThreadMessages: vi.fn(),
  },
}));
vi.mock('@/features/agent-session/agent-session-service', () => ({
  AgentSessionService: {
    getSession: vi.fn(),
    resolveOrCreateSession: vi.fn(),
    updateSurface: vi.fn(),
  },
}));

// ANI-1753: chat/session 라우트가 감사 로그 등을 DB 에 쓰는 경로를 갖는다.
// 대역이 없으면 실제 요청이 나가고, 그 실패가 백그라운드에서 워커 종료코드를 오염시킨다.
vi.mock('@/lib/supabase/server', async () =>
  (await import('./helpers/fake-supabase-server')).fakeServerSupabaseModule(),
);
vi.mock('@/lib/supabase/admin', async () =>
  (await import('./helpers/fake-channel-studio')).fakeAdminModule(),
);

describe('ANI-982 ~ ANI-985: Workspace Actor Authorization & Cross-Tenant Negative Tests', () => {
  const WORKSPACE_A = 'ws-workspace-a';
  const WORKSPACE_B = 'ws-workspace-b';
  const USER_A_ID = 'usr-actor-tenant-a';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Test 1: Cross-Tenant Negative Boundary (403 Forbidden, 0 reads/writes)', () => {
    it('rejects an actor from Workspace A attempting to access Workspace B directly via verifyWorkspaceActor', async () => {
      // Mock membership guard: User is NOT authorized for Workspace B
      vi.spyOn(workspaceGuard, 'requireWorkspaceMembership').mockResolvedValueOnce({
        ok: false,
        status: 403,
        error: 'WORKSPACE_FORBIDDEN',
        message: '해당 작업공간에 대한 접근 권한이 없습니다.',
      });

      const req = new NextRequest(`http://localhost/api/workspaces/${WORKSPACE_B}/agent/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'Exfiltrate data from tenant B' }),
      });

      await expect(verifyWorkspaceActor(req, WORKSPACE_B)).rejects.toThrow(ForbiddenError);
    });

    it('rejects cross-tenant chat execution with 403 and executes 0 orchestrator turns (0 writes)', async () => {
      vi.spyOn(workspaceGuard, 'requireWorkspaceMembership').mockResolvedValueOnce({
        ok: false,
        status: 403,
        error: 'WORKSPACE_FORBIDDEN',
        message: '해당 작업공간에 대한 접근 권한이 없습니다.',
      });

      const req = new NextRequest(`http://localhost/api/workspaces/${WORKSPACE_B}/agent/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'Hello cross tenant' }),
      });

      const response = await chatPost(req, {
        params: Promise.resolve({ workspaceId: WORKSPACE_B }),
      });

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.error).toBe('FORBIDDEN');
      // Verify 0 writes / orchestrator turns executed
      expect(AgentOrchestrator.executeTurn).not.toHaveBeenCalled();
    });

    it('rejects cross-tenant thread reads with 403 and performs 0 DB reads', async () => {
      vi.spyOn(workspaceGuard, 'requireWorkspaceMembership').mockResolvedValueOnce({
        ok: false,
        status: 403,
        error: 'WORKSPACE_FORBIDDEN',
        message: '해당 작업공간에 대한 접근 권한이 없습니다.',
      });

      const req = new NextRequest(`http://localhost/api/workspaces/${WORKSPACE_B}/agent/chat?threadId=th_secret_99`, {
        method: 'GET',
      });

      const response = await chatGet(req, {
        params: Promise.resolve({ workspaceId: WORKSPACE_B }),
      });

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.error).toBe('FORBIDDEN');
      // Verify 0 repository reads
      expect(ConversationRepository.getThreadMessages).not.toHaveBeenCalled();
      expect(ConversationRepository.getThreads).not.toHaveBeenCalled();
    });

    it('rejects cross-tenant session GET and POST with 403', async () => {
      vi.spyOn(workspaceGuard, 'requireWorkspaceMembership').mockResolvedValue({
        ok: false,
        status: 403,
        error: 'WORKSPACE_FORBIDDEN',
        message: '해당 작업공간에 대한 접근 권한이 없습니다.',
      });

      // GET session
      const getReq = new NextRequest(`http://localhost/api/workspaces/${WORKSPACE_B}/agent/session?sessionId=ses_cross_123`, {
        method: 'GET',
      });
      const getRes = await sessionGet(getReq, {
        params: Promise.resolve({ workspaceId: WORKSPACE_B }),
      });
      expect(getRes.status).toBe(403);
      expect(AgentSessionService.getSession).not.toHaveBeenCalled();

      // POST session
      const postReq = new NextRequest(`http://localhost/api/workspaces/${WORKSPACE_B}/agent/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'ses_cross_123' }),
      });
      const postRes = await sessionPost(postReq, {
        params: Promise.resolve({ workspaceId: WORKSPACE_B }),
      });
      expect(postRes.status).toBe(403);
      expect(AgentSessionService.resolveOrCreateSession).not.toHaveBeenCalled();
    });
  });

  describe('Test 2: Server-Authoritative Test Flags & Anti-Spoofing Audit', () => {
    it('forces isTestAccount: false on ACTUAL workspace when client passes isTestAccount: true / noCharge: true, and raises UNAUTHORIZED_TEST_BYPASS_ATTEMPT', async () => {
      vi.spyOn(workspaceGuard, 'requireWorkspaceMembership').mockResolvedValueOnce({
        ok: true,
        userId: USER_A_ID,
        email: 'doctor@clinic-a.com',
        role: 'owner',
        workspaceId: WORKSPACE_A,
      });

      const auditEvents: SecurityAuditEvent[] = [];
      const cleanupListener = onSecurityAuditEvent((event) => {
        auditEvents.push(event);
      });

      const maliciousBody = {
        prompt: 'Generate free content without credit deduction',
        isTestAccount: true,
        noCharge: true,
        datasetMode: 'TEST',
      };

      const req = new NextRequest(`http://localhost/api/workspaces/${WORKSPACE_A}/agent/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(maliciousBody),
      });

      const actor = await verifyWorkspaceActor(req, WORKSPACE_A, maliciousBody);

      // 1. Server-authoritative check: ACTUAL workspace must strictly force isTestAccount to false
      expect(actor.workspaceId).toBe(WORKSPACE_A);
      expect(actor.actorId).toBe(USER_A_ID);
      expect(actor.datasetMode).toBe('ACTUAL');
      expect(actor.isTestAccount).toBe(false);

      // 2. Client-tampered keys must be stripped/ignored
      expect((maliciousBody as any).isTestAccount).toBeUndefined();
      expect((maliciousBody as any).noCharge).toBeUndefined();

      // 3. Security audit event UNAUTHORIZED_TEST_BYPASS_ATTEMPT must be recorded
      expect(auditEvents.length).toBeGreaterThanOrEqual(1);
      const bypassEvent = auditEvents.find((e) => e.eventType === 'UNAUTHORIZED_TEST_BYPASS_ATTEMPT');
      expect(bypassEvent).toBeDefined();
      expect(bypassEvent?.workspaceId).toBe(WORKSPACE_A);
      expect(bypassEvent?.actorId).toBe(USER_A_ID);

      cleanupListener();
    });

    it('chat route ignores client-supplied isTestAccount: true on ACTUAL workspace and executes with isTestAccount: false', async () => {
      vi.spyOn(workspaceGuard, 'requireWorkspaceMembership').mockResolvedValueOnce({
        ok: true,
        userId: USER_A_ID,
        email: 'doctor@clinic-a.com',
        role: 'owner',
        workspaceId: WORKSPACE_A,
      });

      vi.mocked(AgentOrchestrator.executeTurn).mockResolvedValueOnce({
        sessionId: 'ses_1',
        threadId: 'th_1',
        runId: 'run_1',
        step: 'ACTION_CONFIRMED',
        replyContent: '정상 실행되었습니다.',
        creditDeduction: {
          textTokens: 100,
          textSC: 1,
          imageUnits: 0,
          imageSC: 0,
          totalDeductedSC: 1,
          reason: '차감 성공',
        },
      } as any);

      const req = new NextRequest(`http://localhost/api/workspaces/${WORKSPACE_A}/agent/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: '테스트 계정으로 속여서 비용 우회 시도',
          isTestAccount: true,
        }),
      });

      const res = await chatPost(req, {
        params: Promise.resolve({ workspaceId: WORKSPACE_A }),
      });

      expect(res.status).toBe(200);
      // Orchestrator MUST have been called with isTestAccount: false
      expect(AgentOrchestrator.executeTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: WORKSPACE_A,
          isTestAccount: false,
        })
      );
    });
  });

  describe('Test 3: Authorized Actor in Workspace A succeeds', () => {
    it('authorizes valid member of Workspace A with accurate actorId, role, and ACTUAL datasetMode', async () => {
      vi.spyOn(workspaceGuard, 'requireWorkspaceMembership').mockResolvedValueOnce({
        ok: true,
        userId: USER_A_ID,
        email: 'owner@clinic-a.com',
        role: 'owner',
        workspaceId: WORKSPACE_A,
      });

      const req = new NextRequest(`http://localhost/api/workspaces/${WORKSPACE_A}/agent/chat`, {
        method: 'GET',
      });

      const actor = await verifyWorkspaceActor(req, WORKSPACE_A);

      expect(actor).toEqual({
        actorId: USER_A_ID,
        role: 'owner',
        workspaceId: WORKSPACE_A,
        isTestAccount: false,
        datasetMode: 'ACTUAL',
      });
    });

    it('identifies canonical test workspace as isTestAccount: true and TEST datasetMode', async () => {
      const TEST_WS = 'ws-test-byreum';
      vi.spyOn(workspaceGuard, 'requireWorkspaceMembership').mockResolvedValueOnce({
        ok: true,
        userId: 'usr-test-dev',
        email: 'test@example.com',
        role: 'owner',
        workspaceId: TEST_WS,
      });

      const req = new NextRequest(`http://localhost/api/workspaces/${TEST_WS}/agent/chat`, {
        method: 'GET',
      });

      const actor = await verifyWorkspaceActor(req, TEST_WS);

      expect(actor).toEqual({
        actorId: 'usr-test-dev',
        role: 'owner',
        workspaceId: TEST_WS,
        isTestAccount: true,
        datasetMode: 'TEST',
      });
    });

    it('retains isTestAccount: false on commercial workspaces containing partial "test" or "demo" substrings (e.g. ws-contest-clinic, ws-demode-hair)', async () => {
      vi.spyOn(workspaceGuard, 'requireWorkspaceMembership').mockResolvedValueOnce({
        ok: true,
        userId: USER_A_ID,
        email: 'doctor@contest-clinic.com',
        role: 'owner',
        workspaceId: 'ws-contest-clinic',
      });

      const req = new NextRequest('http://localhost/api/workspaces/ws-contest-clinic/agent/chat', {
        method: 'GET',
      });

      const actor = await verifyWorkspaceActor(req, 'ws-contest-clinic');
      expect(actor.isTestAccount).toBe(false);
      expect(actor.datasetMode).toBe('ACTUAL');

      // Demode test
      vi.spyOn(workspaceGuard, 'requireWorkspaceMembership').mockResolvedValueOnce({
        ok: true,
        userId: USER_A_ID,
        email: 'stylist@demode-hair.com',
        role: 'owner',
        workspaceId: 'ws-demode-hair',
      });

      const actorDemo = await verifyWorkspaceActor(req, 'ws-demode-hair');
      expect(actorDemo.isTestAccount).toBe(false);
      expect(actorDemo.datasetMode).toBe('ACTUAL');
    });

    it('fails closed with UnauthorizedError (401) when user is not authenticated', async () => {
      vi.spyOn(workspaceGuard, 'requireWorkspaceMembership').mockResolvedValueOnce({
        ok: false,
        status: 401,
        error: 'AUTH_REQUIRED',
        message: '인증이 필요합니다. 로그인 후 다시 시도해 주세요.',
      });

      const req = new NextRequest(`http://localhost/api/workspaces/${WORKSPACE_A}/agent/chat`, {
        method: 'GET',
      });

      await expect(verifyWorkspaceActor(req, WORKSPACE_A)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('Test 4: Secret & Credential Redaction Helper', () => {
    it('redacts sensitive API keys, Bearer tokens, and secrets from nested error payloads', () => {
      const sensitiveErrorPayload = {
        status: 'FAILED',
        errorCode: 'PROVIDER_AUTH_ERROR',
        apiKey: 'sk-proj-test-dummy-999988887777666655554444',
        nested: {
          clientSecret: ['sb', 'secret_super_secret_production_key_123'].join('_'),
          authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMCda8Yhe3iZaWbvV5XKSTbuAn0M',
          githubToken: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
          normalData: '바이름 청라점',
        },
        errorMessage: 'Connection failed using key sk-live-abcdef1234567890 and secret token',
      };

      const redacted = redactSecrets(sensitiveErrorPayload) as any;

      // Safe metadata preserved
      expect(redacted.status).toBe('FAILED');
      expect(redacted.errorCode).toBe('PROVIDER_AUTH_ERROR');
      expect(redacted.nested.normalData).toBe('바이름 청라점');

      // Sensitive fields redacted
      expect(redacted.apiKey).toBe('[REDACTED]');
      expect(redacted.nested.clientSecret).toBe('[REDACTED]');
      expect(redacted.nested.authorization).toBe('[REDACTED]');
      expect(redacted.nested.githubToken).toBe('[REDACTED]');
      expect(redacted.errorMessage).not.toContain('sk-live-abcdef1234567890');
      expect(redacted.errorMessage).toContain('[REDACTED]');
    });

    it('redacts database connection URI password patterns', () => {
      const uriError = new Error('Database error at postgresql://postgres:mySuperSecretPass123!@db.supabase.co:5432/postgres: timeout');
      const sanitized = redactErrorPayload(uriError);

      expect(sanitized).not.toContain('mySuperSecretPass123!');
      expect(sanitized).toContain('postgresql://postgres:[REDACTED]@db.supabase.co:5432/postgres');
    });

    it('redactErrorPayload handles Error instances cleanly without leaking stack secrets', () => {
      const rawError = new Error('HTTP 401: Invalid token Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token');
      const sanitized = redactErrorPayload(rawError);

      expect(typeof sanitized).toBe('string');
      expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token');
      expect(sanitized).toContain('[REDACTED]');
    });

    it('chat route 500 error handler redacts provider API secrets and connection URI passwords from client response', async () => {
      vi.spyOn(workspaceGuard, 'requireWorkspaceMembership').mockResolvedValueOnce({
        ok: true,
        userId: USER_A_ID,
        email: 'doctor@clinic-a.com',
        role: 'owner',
        workspaceId: WORKSPACE_A,
      });

      // Orchestrator throws an error containing API keys and DB URI
      vi.mocked(AgentOrchestrator.executeTurn).mockRejectedValueOnce(
        new Error('Upstream provider crashed with API Key sk-proj-test-dummy-1234567890abcdef and URI postgres://app_user:dbpass999@db.prod:5432/main')
      );

      const req = new NextRequest(`http://localhost/api/workspaces/${WORKSPACE_A}/agent/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'trigger crash' }),
      });

      const res = await chatPost(req, {
        params: Promise.resolve({ workspaceId: WORKSPACE_A }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.status).toBe('FAILED');
      expect(json.error).not.toContain('sk-proj-test-dummy-1234567890abcdef');
      expect(json.error).not.toContain('dbpass999');
      expect(json.error).toContain('[REDACTED]');
    });

    it('session route 500 error handler redacts secrets from client response', async () => {
      vi.spyOn(workspaceGuard, 'requireWorkspaceMembership').mockResolvedValueOnce({
        ok: true,
        userId: USER_A_ID,
        email: 'doctor@clinic-a.com',
        role: 'owner',
        workspaceId: WORKSPACE_A,
      });

      vi.mocked(AgentSessionService.resolveOrCreateSession).mockRejectedValueOnce(
        new Error('Session DB unreachable at postgresql://postgres:session_secret_pw@db.prod:5432/postgres with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token')
      );

      const req = new NextRequest(`http://localhost/api/workspaces/${WORKSPACE_A}/agent/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      });

      const res = await sessionPost(req, {
        params: Promise.resolve({ workspaceId: WORKSPACE_A }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).not.toContain('session_secret_pw');
      expect(json.message).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token');
      expect(json.message).toContain('[REDACTED]');
    });
  });
});

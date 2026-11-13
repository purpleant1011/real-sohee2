import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator';

vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperatorAnyScope: vi.fn(),
}));

describe('Admin Wing Stack Control API (ANI-775)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOperatorAnyScope).mockResolvedValue({
      operatorId: 'admin-tester',
      role: 'admin',
    } as any);
  });

  it('GET returns 10 default third-party components with SBOM and canary status', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/system/wing-stack');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.components).toBeDefined();
    expect(Array.isArray(json.components)).toBe(true);
    expect(json.components.length).toBeGreaterThanOrEqual(6);
    
    const componentIds = json.components.map((c: any) => c.componentId);
    expect(componentIds).toContain('trigger_dev');
    expect(componentIds).toContain('activepieces');
    expect(componentIds).toContain('postiz');
    expect(componentIds).toContain('google_ads_mcp');

    expect(json.isGlobalKillActive).toBe(false);
    expect(json.asOf).toBeDefined();
  });

  it('POST triggers privileged kill switch when valid reason is provided', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/system/wing-stack', {
      method: 'POST',
      body: JSON.stringify({
        action: 'TRIGGER_KILL_SWITCH',
        scope: 'PROVIDER',
        target: 'postiz',
        reason: 'Postiz API 500 오류 급증으로 인한 임시 격리',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.audit).toBeDefined();
  });

  it('POST rejects privileged operation when reason is missing', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/system/wing-stack', {
      method: 'POST',
      body: JSON.stringify({
        action: 'TRIGGER_KILL_SWITCH',
        scope: 'GLOBAL',
        target: 'ALL',
        reason: '',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Reason is mandatory/i);
  });
});

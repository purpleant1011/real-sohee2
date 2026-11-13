import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// The route now runs the shared cross-tenant guard before touching plugin state, so this
// suite authenticates as a member of the workspace under test. Expectations are unchanged.
const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (value: unknown) => value instanceof Response,
}));

import { GET, POST } from '../route';
import { BYREUM_WORKSPACE_ID } from '@/features/content/content-draft-service';

describe('/api/workspaces/[workspaceId]/plugins', () => {
  const workspaceId = 'ws-test-plugins-101';

  beforeEach(() => {
    authorize.mockReset();
    authorize.mockResolvedValue({ userId: 'user-owner', workspaceId, role: 'owner', supabase: {}, admin: {} });
  });

  it('does not set seed connected accounts for non-Byreum workspace', async () => {
    const nonByreumWs = 'ws-non-byreum-custom-store';
    authorize.mockResolvedValue({ userId: 'user-owner', workspaceId: nonByreumWs, role: 'owner', supabase: {}, admin: {} });
    const req = new NextRequest(`http://localhost:3000/api/workspaces/${nonByreumWs}/plugins`);
    const res = await GET(req, { params: Promise.resolve({ workspaceId: nonByreumWs }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    const instagram = data.plugins.find((p: any) => p.manifest.pluginId === 'plg_instagram_growth');
    const naver = data.plugins.find((p: any) => p.manifest.pluginId === 'plg_naver_blog_marketing');

    expect(instagram.connectedAccountId).toBeNull();
    expect(instagram.state).toBe('AUTH_REQUIRED');
    expect(naver.connectedAccountId).toBeNull();
    expect(naver.state).toBe('AUTH_REQUIRED');
  });

  it('sets seed connected accounts for Byreum canonical workspace', async () => {
    const byreumWs = BYREUM_WORKSPACE_ID;
    authorize.mockResolvedValue({ userId: 'user-owner', workspaceId: byreumWs, role: 'owner', supabase: {}, admin: {} });
    const req = new NextRequest(`http://localhost:3000/api/workspaces/${byreumWs}/plugins`);
    const res = await GET(req, { params: Promise.resolve({ workspaceId: byreumWs }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    const instagram = data.plugins.find((p: any) => p.manifest.pluginId === 'plg_instagram_growth');
    const naver = data.plugins.find((p: any) => p.manifest.pluginId === 'plg_naver_blog_marketing');

    expect(instagram.connectedAccountId).toBe('@studio_byreum');
    expect(naver.connectedAccountId).toBe('byreum_beauty');
  });

  it('GET returns catalog plugins with installation states', async () => {
    const req = new NextRequest(`http://localhost:3000/api/workspaces/${workspaceId}/plugins`);
    const res = await GET(req, { params: Promise.resolve({ workspaceId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.plugins).toBeDefined();
    expect(data.totalCatalogCount).toBeGreaterThanOrEqual(10);
    expect(data.installedCount).toBeGreaterThan(0);
  });

  it('POST INSTALL installs an available plugin', async () => {
    const req = new NextRequest(`http://localhost:3000/api/workspaces/${workspaceId}/plugins`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'INSTALL',
        pluginId: 'plg_google_ads_intelligence',
        planTier: 'TIER_300K_GROWTH',
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ workspaceId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(['READY', 'AUTH_REQUIRED']).toContain(data.state);
  });

  it('POST CONNECT advances plugin to READY state', async () => {
    const req = new NextRequest(`http://localhost:3000/api/workspaces/${workspaceId}/plugins`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'CONNECT',
        pluginId: 'plg_kakao_consult',
        accountId: 'kakao_channel_biz',
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ workspaceId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.state).toBe('READY');
  });

  it('POST UNINSTALL removes the plugin', async () => {
    const req = new NextRequest(`http://localhost:3000/api/workspaces/${workspaceId}/plugins`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'UNINSTALL',
        pluginId: 'plg_google_ads_intelligence',
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ workspaceId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.state).toBe('AVAILABLE');
  });
});

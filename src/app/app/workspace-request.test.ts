// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

vi.mock('@/lib/supabase/server', () => ({}))

// 실제 RSC dispatcher로 검증한다. React.cache를 흉내 내는 전역 Map은 요청 격리를 증명하지 못한다.
describe('홈의 요청 단위 인증·가게 조회', () => {
  it('동일 RSC 요청의 소비자는 조회를 공유하고 다음 요청은 다른 사용자·가게를 재검증한다', async () => {
    const result = await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
          import React from 'react';
          import { createRequire } from 'node:module';
          import Home from './src/app/app/page';
          import Layout from './src/app/app/protected-app-content';
          const require = createRequire(import.meta.url);
          const { renderToReadableStream } = require('next/dist/compiled/react-server-dom-webpack/server.node');
          globalThis.fixture = { user: 'user-a', workspace: '11111111-1111-4111-8111-111111111111', claims: 0, memberships: 0 };
          async function render() {
            const stream = await renderToReadableStream(React.createElement(Layout, null, React.createElement(Home)), {});
            return new Response(stream).text();
          }
          const first = await render();
          const firstCounts = { claims: fixture.claims, memberships: fixture.memberships };
          fixture.user = 'user-b'; fixture.workspace = '22222222-2222-4222-8222-222222222222';
          const second = await render();
          console.log(JSON.stringify({ firstCounts, finalCounts: { claims: fixture.claims, memberships: fixture.memberships }, first, second }));
        `,
      },
      bundle: true, platform: 'node', format: 'esm', write: false,
      external: ['react', 'node:module'],
      plugins: [{
        name: 'request-boundary-fixtures',
        setup(builder) {
          const boundaries: Record<string, string> = {
            '@/features/mobile-shell/r2-gate': 'export const MobileR2Provider = ({children}) => children',
            '@/features/agent-dock/conversation-navigation-provider': 'export const ConversationNavigationProvider = ({children}) => children',
            '@/features/mobile-shell/mobile-app-shell': 'export const PersistentMobileShell = ({children}) => children',
            '@/features/mobile-shell/r2-flag': 'export const resolveMobileR2Enabled = () => true',
            '@/features/mobile-decision/mobile-ui-provider': 'export const MobileUiProvider = ({children}) => children',
            '@/features/mobile-decision/navigation': 'export const resolveMobileUiEnabled = () => false',
            '@/components/workspace/workspace-provider': 'export const WorkspaceProvider = ({children}) => children',
            '@/components/membership/membership-banner': 'export const MembershipBanner = () => null',
            '@/features/membership/membership-tier': 'export const getMembershipTier = async () => "FORMAL"',
            '@/features/sohee-ready/read-model': 'export const getSoheeReadiness = async () => ({ready: true})',
            '@/features/sohee-ready/shell-resolver': 'export const resolveAppShellMode = () => "APP_SHELL"',
            '@/features/business-verification/entry-gate': 'export const isApplicationSubmitted = () => true; export const resolveAppEntryRedirect = () => null',
            '@/features/readiness': 'export const evaluateReadiness = () => ({prepared: true})',
            '@/lib/supabase/admin': 'export const createAdminSupabaseClient = () => ({})',
            'next/headers': 'export const headers = async () => new Headers()',
          }
          builder.onResolve({ filter: /^(?:@\/|next\/headers)/ }, ({ path }) => boundaries[path] ? { path, namespace: 'boundary' } : undefined)
          builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({ contents: boundaries[path] }))
          builder.onResolve({ filter: /^server-only$/ }, () => ({ path: 'empty', namespace: 'fixture' }))
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: '' }))
          builder.onLoad({ filter: /lib\/supabase\/server\.ts$/ }, () => ({ contents: `
            export async function createServerSupabaseClient() {
              return {
                auth: { getClaims: async () => { fixture.claims++; return { data: { claims: { sub: fixture.user } } }; } },
                from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({data: {name: '테스트 가게', status: 'VERIFIED'}}), order: async () => { fixture.memberships++; return { data: [{ workspace_id: fixture.workspace, role: 'owner', status: 'active' }], error: null }; } }; return q; },
              };
            }
          ` }))
          builder.onLoad({ filter: /auth\/active-workspace\.server\.ts$/ }, () => ({ contents: 'export async function readPreferredWorkspaceIdFromCookies() { return null }' }))
          builder.onLoad({ filter: /home-today\/today-home\.tsx$/ }, () => ({ contents: `import React from 'react'; export function TodayHome({workspaceId}) { return React.createElement('main', null, workspaceId) }` }))
          builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'next-fixture' }))
          builder.onLoad({ filter: /.*/, namespace: 'next-fixture' }, () => ({ contents: 'export function redirect(path) { throw new Error(path) }' }))
        },
      }],
    })
    const child = spawnSync(process.execPath, ['--conditions=react-server', '--input-type=module'], {
      cwd: resolve('.'), input: result.outputFiles[0].text, encoding: 'utf8', timeout: 20_000,
    })
    expect(child.status, child.stderr).toBe(0)
    const output = JSON.parse(child.stdout.trim())
    expect(output.firstCounts).toEqual({ claims: 1, memberships: 1 })
    expect(output.finalCounts).toEqual({ claims: 2, memberships: 2 })
    expect(output.first).toContain('11111111-1111-4111-8111-111111111111')
    expect(output.second).toContain('22222222-2222-4222-8222-222222222222')
    expect(output.second).not.toContain('11111111-1111-4111-8111-111111111111')
  })
})

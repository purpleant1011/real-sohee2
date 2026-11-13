import { vi } from 'vitest'

/**
 * `content.generate` 는 4채널 스튜디오(DB·크레딧 의존)를 호출한다.
 * 단위/통합 성격의 테스트가 실제 DB 없이도 도구 디스패치 경로를 검증할 수 있도록 서비스를 대체한다.
 *
 * 사용(vi.mock 은 파일 최상단으로 호이스팅되므로 팩토리 안에서 동적 import 한다):
 *   vi.mock('@/lib/supabase/admin', async () => (await import('./helpers/fake-channel-studio')).fakeAdminModule())
 *   vi.mock('@/features/channel-studio/compose', async () => (await import('./helpers/fake-channel-studio')).fakeComposeModule())
 */
export function fakeStudioResult(req: { topic: string; requestKey: string }) {
  return {
    requestKey: req.requestKey,
    topic: req.topic,
    createdAt: '2026-10-09T00:00:00.000Z',
    basisNotes: [],
    imageNotice: null,
    variants: [
      {
        channel: 'instagram' as const,
        payload: { caption: '테스트 원고입니다.', hashtags: ['#테스트'] },
        status: 'READY' as const,
        statusLabel: '보관할 수 있어요',
        issues: [] as string[],
        contentId: 'cid-fake',
        versionId: 'vid-fake',
        vaultSavable: true,
        blockedReason: null,
      },
    ],
  }
}

export function fakeAdminModule() {
  return { createAdminSupabaseClient: vi.fn(() => ({})) }
}

export function fakeComposeModule() {
  return {
    createChannelDraftService: vi.fn(() => ({
      generate: vi.fn(async (req: { topic: string; requestKey: string }) => fakeStudioResult(req)),
      edit: vi.fn(),
      listRecent: vi.fn(),
    })),
  }
}

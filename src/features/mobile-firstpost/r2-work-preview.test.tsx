// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'

/** 사진 측정·네트워크는 이 화면의 계약이 아니므로 바꿔 끼운다. 셸은 자체 계약 테스트가 있다. */
const env = vi.hoisted(() => ({
  online: true,
  measurement: 'measured' as 'measured' | 'failed' | 'measuring',
  /** 훅에 넘어간 세대 번호. '다시 확인'이 측정을 다시 시작하는지 이 값으로 본다. */
  attempts: [] as number[],
}))

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('@/features/mobile-shell', () => ({ ShellScreen: () => null }))
vi.mock('@/features/pwa/network', () => ({ useOnlineStatus: () => env.online }))
vi.mock('./measured-asset', () => ({
  useMeasuredImage: (
    asset: { assetId: string; imageUrl: string; width: number; height: number; rights: 'CONFIRMED' | 'UNCONFIRMED' } | null,
    attempt = 0,
  ) => {
    env.attempts.push(attempt)
    if (!asset) return { asset: null, status: 'none' }
    if (env.measurement === 'measured') return { asset: { ...asset, width: 1080, height: 1350 }, status: 'measured' }
    if (env.measurement === 'failed') return { asset, status: 'failed' }
    return { asset, status: 'measuring' }
  },
}))

import {
  R2WorkPreview,
  isPreviewChannel,
  previewLoad,
  snapshotAsset,
  snapshotAssetIssue,
  snapshotCapabilities,
  snapshotRights,
} from './r2-work-preview'

const SNAPSHOT: ApprovalPreviewSnapshot = {
  workspaceId: 'ws-1',
  contentId: 'c1',
  versionId: 'v1',
  versionNumber: 2,
  fingerprint: 'f'.repeat(64),
  approval: { id: null, status: 'unreviewed', fingerprint: null },
  channel: 'instagram',
  account: { connectionId: 'conn-1', label: '@sohee', status: 'connected' },
  caption: '',
  hashtags: [],
  disclosure: '',
  text: '신메뉴 출시\n\n#신메뉴',
  media: [{ id: 'm1', position: 1, mimeType: 'image/jpeg', altText: '사진', src: '/api/workspaces/ws-1/media/m1' }],
  issues: [],
}

const withIssues = (...codes: string[]): ApprovalPreviewSnapshot => ({
  ...SNAPSHOT,
  issues: codes.map((code) => ({ code, message: code })),
})

beforeEach(() => {
  env.online = true
  env.measurement = 'measured'
  env.attempts.length = 0
  router.push.mockClear()
  router.refresh.mockClear()
})

describe('M06 실라우트 홍보 세트 (ANI-1678)', () => {
  it('서버 스냅샷의 사진·문구를 실제 데이터로 그린다', () => {
    render(<R2WorkPreview snapshot={SNAPSHOT} />)

    expect(screen.getByRole('heading', { name: '홍보 미리보기' })).toBeTruthy()
    const img = screen.getByAltText('올릴 사진') as HTMLImageElement
    // 상대 경로는 같은 출처로만 절대 주소가 된다(바깥 출처를 만들지 않는다).
    expect(img.getAttribute('src')).toBe(new URL('/api/workspaces/ws-1/media/m1', window.location.origin).toString())
    expect(document.body.textContent).toContain('신메뉴 출시')
    // 실제 데이터는 별도 라벨이 없고(예시·시험 라벨 금지), 모드는 데이터 속성으로만 남는다.
    expect(document.querySelector('[data-dataset-mode]')?.getAttribute('data-dataset-mode')).toBe('ACTUAL')
    expect(document.querySelector('[data-dataset-mode-label]')).toBeNull()
  })

  it('게시 버튼은 없고 검토는 승인 화면으로 이동한다', () => {
    render(<R2WorkPreview snapshot={SNAPSHOT} />)

    expect(screen.queryByRole('button', { name: '게시하기' })).toBeNull()
    // 이동만 한다 — 이 화면에서 게시·예약 명령을 보내지 않는다.
    fireEvent.click(screen.getByRole('button', { name: '이 내용 검토' }))
    expect(router.push).toHaveBeenCalledWith('/app/work/c1/approve')
    expect(screen.getByRole('button', { name: '복사' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '다운로드' })).not.toBeDisabled()
    // 원고 저장 API 가 없으므로 저장은 사유와 함께 닫혀 있다(저장된 척 금지).
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
    expect(document.body.textContent).toContain('원고 저장은 아직 준비 중이에요.')
  })

  it('원고를 고치는 입력 상자를 두지 않는다(저장할 수 없는 편집)', () => {
    render(<R2WorkPreview snapshot={SNAPSHOT} />)

    expect(screen.queryByLabelText('인스타그램 문구')).toBeNull()
    expect(screen.queryByLabelText('행동 유도 문구')).toBeNull()
    expect(document.body.textContent).toContain('문구 고치기는 편집 화면에서 할 수 있어요.')
  })

  it('실제 데이터 화면에서는 예시 화면 문구를 쓰지 않는다', () => {
    render(<R2WorkPreview snapshot={SNAPSHOT} />)

    expect(document.body.textContent).not.toContain('예시 화면이라')
    // 게시 권한을 확인하지 못했으므로 직접 올릴 수 있게 준비한 상태를 말한다.
    expect(document.body.textContent).toContain('게시 권한이 확인되지 않아')
  })

  it('스냅샷에 없는 채널 탭을 그리지 않는다(눌러도 바뀌지 않는 조작)', () => {
    render(<R2WorkPreview snapshot={SNAPSHOT} />)

    expect(screen.queryByRole('radiogroup', { name: '채널 선택' })).toBeNull()
    expect(document.body.textContent).not.toContain('스레드')
  })

  it('다시 확인은 서버 새로고침과 사진 재측정을 함께 시작한다', () => {
    env.measurement = 'failed'
    render(<R2WorkPreview snapshot={SNAPSHOT} />)
    expect(env.attempts.at(-1)).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))

    expect(router.refresh).toHaveBeenCalled()
    // 세대 번호가 바뀌어야 같은 사진을 다시 잰다(클라이언트 상태는 refresh 로 보존된다).
    expect(env.attempts.at(-1)).toBe(1)
  })

  it('사진 원본 크기를 재는 동안은 skeleton 이고 내용을 그리지 않는다', () => {
    env.measurement = 'measuring'
    render(<R2WorkPreview snapshot={SNAPSHOT} />)

    expect(screen.queryByRole('heading', { name: '홍보 미리보기' })).toBeNull()
    expect(screen.getByText('확인하는 중이에요')).toBeTruthy()
  })

  it('크기를 재지 못하면 부분 상태로 알리고 미리보기를 막는다', () => {
    env.measurement = 'failed'
    render(<R2WorkPreview snapshot={SNAPSHOT} />)

    expect(document.body.textContent).toContain('일부만 불러왔어요')
    expect(screen.getByRole('alert').textContent).toContain('사진 크기를 확인하지 못했어요')
    expect(screen.getByRole('button', { name: '복사' })).toBeDisabled()
  })

  it('승인 후 문구가 바뀐 스냅샷은 이전 확인 내용으로 표시한다(내용은 숨기지 않는다)', () => {
    render(<R2WorkPreview snapshot={withIssues('approval_stale')} />)

    expect(document.body.textContent).toContain('이전에 확인한 내용이에요')
    expect(document.body.textContent).toContain('신메뉴 출시')
  })

  it('오프라인이면 마지막 확인 내용을 실제처럼 그리지 않는다', () => {
    env.online = false
    render(<R2WorkPreview snapshot={SNAPSHOT} />)

    expect(document.body.textContent).toContain('네트워크에 연결할 수 없습니다')
    expect(screen.queryByAltText('올릴 사진')).toBeNull()
  })

  it('스냅샷 조회 실패는 빈 화면이 아니라 오류 상태다', () => {
    render(<R2WorkPreview snapshot={null} />)

    expect(screen.getByRole('alert').textContent).toContain('불러오지 못했어요')
    expect(screen.queryByRole('heading', { name: '홍보 미리보기' })).toBeNull()
  })

  it('사용권 미확인 사진은 그리지 않고 복사·다운로드를 막는다', () => {
    render(<R2WorkPreview snapshot={withIssues('media_rights')} />)

    expect(screen.getByRole('alert').textContent).toContain('사진 사용 확인이 필요해요')
    expect(screen.queryByAltText('올릴 사진')).toBeNull()
    expect(screen.getByRole('button', { name: '복사' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '다운로드' })).toBeDisabled()
  })

  it('사진이 없는 초안은 사진 없음으로 말한다', () => {
    render(<R2WorkPreview snapshot={{ ...SNAPSHOT, media: [] }} />)

    expect(screen.getByRole('alert').textContent).toContain('사진이 아직 없어요')
  })

  it('사진 주소가 이 워크스페이스 자산이 아니면 그리지 않고 사유를 말한다', () => {
    const external: ApprovalPreviewSnapshot = {
      ...SNAPSHOT,
      media: [{ ...SNAPSHOT.media[0], src: 'https://cdn.example.com/photo.jpg' }],
    }
    render(<R2WorkPreview snapshot={external} />)

    expect(screen.queryByAltText('올릴 사진')).toBeNull()
    // '사진이 아직 없어요'가 아니라 주소를 확인하지 못한 사유다.
    expect(screen.getByRole('alert').textContent).toContain('사진을 다시 불러와야 해요')
    expect(screen.getByRole('button', { name: '다운로드' })).toBeDisabled()
  })

  it('사진 주소가 잘못된 형식이면 주소 문제로 말한다', () => {
    const malformed: ApprovalPreviewSnapshot = {
      ...SNAPSHOT,
      media: [{ ...SNAPSHOT.media[0], src: 'javascript:alert(1)' }],
    }
    render(<R2WorkPreview snapshot={malformed} />)

    expect(screen.queryByAltText('올릴 사진')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('사진을 불러오지 못했어요')
  })
})

describe('스냅샷 → 화면 매핑', () => {
  it('M06 이 다루지 않는 채널은 화면 대상이 아니다', () => {
    expect(isPreviewChannel('instagram')).toBe(true)
    expect(isPreviewChannel('threads')).toBe(true)
    expect(isPreviewChannel('naver_blog')).toBe(false)
  })

  it('사용권은 서버 문제 코드가 있을 때만 미확인이다', () => {
    expect(snapshotRights(SNAPSHOT)).toBe('CONFIRMED')
    expect(snapshotRights(withIssues('media_rights'))).toBe('UNCONFIRMED')
    expect(snapshotRights(withIssues('evidence'))).toBe('UNCONFIRMED')
    // 사진 설명 누락은 사용권 문제가 아니다.
    expect(snapshotRights(withIssues('media_alt_text'))).toBe('CONFIRMED')
  })

  it('연결만 확인돼도 게시 권한은 열리지 않는다(fail-closed)', () => {
    const [cap] = snapshotCapabilities(SNAPSHOT)
    expect(cap).toMatchObject({ channel: 'instagram', connection: 'CONNECTED', canPublish: false })

    const [unknown] = snapshotCapabilities({ ...SNAPSHOT, account: { ...SNAPSHOT.account, status: 'connecting' } })
    expect(unknown).toMatchObject({ connection: 'UNKNOWN', canPublish: false })

    const [down] = snapshotCapabilities({ ...SNAPSHOT, account: { ...SNAPSHOT.account, status: 'missing_permission' } })
    expect(down).toMatchObject({ connection: 'NOT_CONNECTED', canPublish: false })

    expect(snapshotCapabilities(null)).toEqual([])
    expect(snapshotCapabilities({ ...SNAPSHOT, channel: 'naver_blog' })).toEqual([])
  })

  it('사진은 position 순 첫 장이고 크기는 브라우저가 잰다(0 으로 두고 지어내지 않는다)', () => {
    const asset = snapshotAsset(
      {
        ...SNAPSHOT,
        media: [
          { id: 'm2', position: 2, mimeType: 'image/png', altText: '', src: '/api/workspaces/ws-1/media/m2' },
          { id: 'm1', position: 1, mimeType: 'image/jpeg', altText: '사진', src: '/api/workspaces/ws-1/media/m1' },
        ],
      },
      'https://example.com',
    )
    expect(asset).toMatchObject({
      assetId: 'm1',
      imageUrl: 'https://example.com/api/workspaces/ws-1/media/m1',
      width: 0,
      height: 0,
    })
    expect(snapshotAsset(null, null)).toBeNull()
    expect(snapshotAsset({ ...SNAPSHOT, media: [] }, null)).toBeNull()
  })

  it('서버가 원본 크기를 알면 그 값을 쓰고, 0 이면 모름으로 둔다(ANI-1764)', () => {
    // 서버 DTO(원본 기준)가 있으면 브라우저 실측을 기다리지 않는다.
    expect(snapshotAsset({
      ...SNAPSHOT,
      media: [{ id: 'm1', position: 1, mimeType: 'image/jpeg', altText: '사진', src: '/api/workspaces/ws-1/media/m1', width: 1080, height: 1350 }],
    }, 'https://example.com')).toMatchObject({ width: 1080, height: 1350 })

    // 0 은 크기가 아니다 — 미리보기를 그리지 않고 브라우저 실측으로 넘긴다.
    expect(snapshotAsset({
      ...SNAPSHOT,
      media: [{ id: 'm1', position: 1, mimeType: 'image/jpeg', altText: '사진', src: '/api/workspaces/ws-1/media/m1', width: 0, height: null }],
    }, 'https://example.com')).toMatchObject({ width: 0, height: 0 })
  })

  it('사진 주소는 이 워크스페이스 media 경로 + 같은 자산 id 여야 한다(fail-closed)', () => {
    const at = (src: string) =>
      snapshotAsset({ ...SNAPSHOT, media: [{ ...SNAPSHOT.media[0], src }] }, 'https://example.com')
    const issue = (src: string) =>
      snapshotAssetIssue({ ...SNAPSHOT, media: [{ ...SNAPSHOT.media[0], src }] }, 'https://example.com')

    // 같은 출처의 상대 경로·절대 주소는 통과한다.
    expect(at('/api/workspaces/ws-1/media/m1')).not.toBeNull()
    expect(at('https://example.com/api/workspaces/ws-1/media/m1')).not.toBeNull()

    // 바깥 출처·다른 워크스페이스·다른 자산 id 는 그리지 않는다 — 화면 사진과 승인 대상이 어긋난다.
    expect(at('https://cdn.example.com/photo.jpg')).toBeNull()
    expect(at('/api/workspaces/ws-2/media/m1')).toBeNull()
    expect(at('/api/workspaces/ws-1/media/m9')).toBeNull()
    expect(issue('https://cdn.example.com/photo.jpg')).toBe('MISSING_ASSET_ID')
    expect(issue('/api/workspaces/ws-2/media/m1')).toBe('MISSING_ASSET_ID')
    expect(issue('/api/workspaces/ws-1/media/m9')).toBe('MISSING_ASSET_ID')

    // 실제 데이터에서 인라인 자리표시자·스크립트 주소는 사진이 아니다.
    expect(at('data:image/png;base64,AAAA')).toBeNull()
    expect(issue('javascript:alert(1)')).toBe('INVALID_IMAGE_URL')
    expect(issue('/api/workspaces/ws-1/media/m1')).toBeNull()
  })

  it('예시 모드에서만 저장소 예시 사진이 통과하고, 실제 모드는 그대로 막는다 (개발 하네스)', () => {
    // 개발 하네스는 공개 예시 사진을 쓴다. ACTUAL 로 두면 fail-closed 로 막혀 화면 배치를 볼 수 없었다.
    const sample = { ...SNAPSHOT, media: [{ ...SNAPSHOT.media[0], src: '/sohee_insta_post.jpg' }] }
    const at = (mode: 'ACTUAL' | 'SHOWCASE_DEMO') => snapshotAsset(sample, 'http://localhost:3211', mode)

    expect(at('ACTUAL')).toBeNull()
    expect(snapshotAssetIssue(sample, 'http://localhost:3211', 'ACTUAL')).toBe('MISSING_ASSET_ID')
    expect(at('SHOWCASE_DEMO')).toMatchObject({ imageUrl: 'http://localhost:3211/sohee_insta_post.jpg' })
    expect(snapshotAssetIssue(sample, 'http://localhost:3211', 'SHOWCASE_DEMO')).toBeNull()

    // 예시 모드라도 바깥 출처는 받지 않는다.
    const external = { ...SNAPSHOT, media: [{ ...SNAPSHOT.media[0], src: 'https://cdn.example.com/a.jpg' }] }
    expect(snapshotAsset(external, 'http://localhost:3211', 'SHOWCASE_DEMO')).toBeNull()
  })

  it('상태 우선순위: 오프라인 > 조회 실패 > 측정 중 > 이전 확인 > 부분', () => {
    const base = { online: true, hasSnapshot: true, measurement: 'measured' as const, stale: false }
    expect(previewLoad({ ...base, online: false, hasSnapshot: false, measurement: 'measuring', stale: true })).toBe('offline')
    expect(previewLoad({ ...base, hasSnapshot: false, measurement: 'measuring', stale: true })).toBe('error')
    expect(previewLoad({ ...base, measurement: 'measuring', stale: true })).toBe('loading')
    expect(previewLoad({ ...base, stale: true })).toBe('stale')
    expect(previewLoad({ ...base, measurement: 'failed' })).toBe('partial')
    expect(previewLoad(base)).toBe('ready')
  })
})

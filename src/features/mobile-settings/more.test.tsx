// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MobileMoreView } from './more-view'
import { MORE_SECTION_LABEL, MORE_SECTION_HREF, dropForeignKeys, needsReauth, orderedSections, privacyAction, scopedKey, scopedTo, type MoreViewSnapshot } from './more-model'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/features/auth/actions', () => ({ signOutAction: vi.fn() }))
vi.mock('@/features/pwa/sw-client', () => ({ clearPwaCaches: vi.fn() }))

const NOW = '2026-10-23T09:00:00.000Z'
function snap(o: Partial<MoreViewSnapshot> = {}): MoreViewSnapshot {
  return {
    loadState: 'ready', workspaceId: 'a', now: NOW, checkedAt: NOW, lastReauthAt: '2026-10-23T08:55:00.000Z',
    workspaces: [{ id: 'a', name: '바이름 청라', role: 'owner' }, { id: 'b', name: '바이름 송도', role: 'owner' }],
    sections: [{ id: 'billing', status: 'attention', summary: '잔액 확인 필요' }],
    privacy: { export: 'none', withdraw: 'none' }, ...o,
  }
}

describe('more model', () => {
  it('채널 연결과 가게 정보 학습의 메뉴 의미를 분리한다', () => {
    expect(MORE_SECTION_LABEL.channels).toBe('채널 연결')
    expect(MORE_SECTION_HREF.store).toBe('/app/settings/business')
  })
  it('섹션은 고정 순서이고 빠진 섹션은 확인하지 못함으로 채운다', () => {
    const s = orderedSections([{ id: 'billing', status: 'ok', summary: null }])
    expect(s.map(x => x.id)).toEqual(['store', 'channels', 'automation', 'notifications', 'billing', 'security'])
    expect(s[0].status).toBe('unknown')
  })
  it('다른 가게 데이터·캐시 키는 걸러진다', () => {
    expect(scopedTo([{ workspaceId: 'a', n: 1 }, { workspaceId: 'b', n: 2 }], 'a')).toEqual([{ workspaceId: 'a', n: 1 }])
    expect(Object.keys(dropForeignKeys({ [scopedKey('a', 'x')]: 1, [scopedKey('b', 'x')]: 2 }, 'b'))).toEqual(['b::x'])
  })
  it('본인 확인이 오래됐거나 없으면 재확인, 진행 중이면 중복 요청 불가', () => {
    expect(needsReauth(null, new Date(NOW))).toBe(true)
    expect(needsReauth('x', new Date(NOW))).toBe(true)
    expect(needsReauth('2026-10-23T08:55:00.000Z', new Date(NOW))).toBe(false)
    expect(privacyAction('processing', false)).toBe('disabled')
    expect(privacyAction('none', true)).toBe('reauth')
    expect(privacyAction('failed', false)).toBe('request')
  })
  it('앱에 실제로 있는 화면만 섹션 이동 대상으로 잡는다', () => {
    expect(Object.keys(MORE_SECTION_HREF).sort()).toEqual(['automation', 'billing', 'channels', 'notifications', 'store'])
    for (const href of Object.values(MORE_SECTION_HREF)) expect(href.startsWith('/app/')).toBe(true)
    // 보안·개인정보는 /app 안에 요청 화면이 아직 없다. 없는 화면으로 보내지 않는다.
    expect(MORE_SECTION_HREF.security).toBeUndefined()
  })
})

describe('MobileMoreView', () => {
  it('현재 가게와 가게 전환 목록을 보여주고 현재 가게는 눌러도 전환하지 않는다', () => {
    const go = vi.fn()
    render(<MobileMoreView snapshot={snap()} onSwitchWorkspace={go} />)
    expect(screen.getByText('지금 보는 가게: 바이름 청라')).toBeTruthy()
    expect((screen.getByRole('button', { name: /바이름 청라/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '바이름 송도' }))
    expect(go).toHaveBeenCalledWith('b')
  })
  it('가게가 하나면 전환 영역을 그리지 않는다', () => {
    render(<MobileMoreView snapshot={snap({ workspaces: [{ id: 'a', name: '바이름 청라', role: 'owner' }] })} />)
    expect(screen.queryByLabelText('가게 바꾸기')).toBeNull()
  })
  it('조회 실패면 설정·개인정보를 그리지 않고 실패를 알린다', () => {
    render(<MobileMoreView snapshot={snap({ loadState: 'error' })} />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByLabelText('개인정보')).toBeNull()
  })
  it('권한이 없으면 조회 실패도 빈 목록도 아닌 권한 안내로 알린다', () => {
    render(<MobileMoreView snapshot={snap({ loadState: 'error', authFailure: 'forbidden' })} />)
    expect(screen.getByText('이 내용을 볼 권한이 없어요')).toBeTruthy()
    expect(screen.getByText('가게 관리자에게 권한을 요청해 주세요.')).toBeTruthy()
    expect(screen.queryByText('불러오지 못했어요')).toBeNull()
    // 권한이 없으면 섹션 상태를 알 수 없다. '확인하지 못함' 목록을 확인된 것처럼 그리지 않는다.
    expect(screen.queryByLabelText('설정 목록')).toBeNull()
    expect(screen.queryByLabelText('개인정보')).toBeNull()
  })
  it('로그인이 만료되면 권한 없음이 아니라 다시 로그인할 일로 알린다', () => {
    render(<MobileMoreView snapshot={snap({ loadState: 'error', authFailure: 'expired' })} />)
    expect(screen.getByText('로그인이 만료됐어요')).toBeTruthy()
    expect(screen.getByText('다시 로그인하면 이어서 볼 수 있어요.')).toBeTruthy()
    expect(screen.queryByText('이 내용을 볼 권한이 없어요')).toBeNull()
    expect(screen.queryByText('불러오지 못했어요')).toBeNull()
    expect(screen.queryByLabelText('설정 목록')).toBeNull()
    expect(screen.queryByLabelText('개인정보')).toBeNull()
  })
  it('더보기에는 탈퇴 상태 대신 개인정보 관리 진입점을 둔다', () => {
    render(<MobileMoreView snapshot={snap()} />)
    expect(screen.queryByText('탈퇴')).toBeNull()
    expect(screen.queryByText('진행 상태를 확인하지 못했어요')).toBeNull()
    expect(screen.getByRole('link', { name: /개인정보 관리/ })).toHaveAttribute('href', '/app/system/privacy')
  })
  it('섹션을 누르면 그 섹션 id 로 이동을 요청한다', () => {
    const open = vi.fn()
    render(<MobileMoreView snapshot={snap()} onOpenSection={open} />)
    fireEvent.click(screen.getByRole('button', { name: /가게 정보/ }))
    expect(open).toHaveBeenCalledWith('store')
    fireEvent.click(screen.getByRole('button', { name: /이용 요금/ }))
    expect(open).toHaveBeenCalledWith('billing')
  })
  it('우리 가게 그룹에 이미지 스타일 항목이 있고 /app/settings/image-style 로 연결된다', () => {
    render(<MobileMoreView snapshot={snap()} />)
    const link = screen.getByRole('link', { name: /이미지 스타일/ })
    expect(link).toHaveAttribute('href', '/app/settings/image-style')
  })
  it('연결 그룹에 업무 도구 연결 항목이 있고 /app/connectors 로 연결된다', () => {
    render(<MobileMoreView snapshot={snap()} />)
    const link = screen.getByRole('link', { name: /업무 도구 연결/ })
    expect(link).toHaveAttribute('href', '/app/connectors')
  })
  it('열 화면이 없는 항목은 메뉴 항목으로 만들지 않는다', () => {
    render(<MobileMoreView snapshot={snap()} onOpenSection={vi.fn()} />)
    expect(screen.queryByText('보안·개인정보')).toBeNull()
    expect(screen.queryByText('결제 내역')).toBeNull()
  })
  it('이동 처리기가 없으면 섹션은 버튼이 아니다', () => {
    render(<MobileMoreView snapshot={snap()} />)
    expect(screen.getByText('가게 정보')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /가게 정보/ })).toBeNull()
  })
  it.each(['loading', 'error', 'ready'] as const)('%s 상태에서도 로그아웃은 조회 영역 밖에 표시한다', (loadState) => {
    render(<MobileMoreView snapshot={snap({ loadState })} />)
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeEnabled()
  })
})

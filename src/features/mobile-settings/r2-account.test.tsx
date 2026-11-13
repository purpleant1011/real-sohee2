// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/features/mobile-shell', () => ({
  MobileAppShell: ({ children }: { children: ReactElement }) => <>{children}</>,
  ShellScreen: ({ children }: { children: ReactElement }) => <>{children}</>,
}))

const save = vi.hoisted(() => vi.fn())
vi.mock('@/features/settings/actions/save-settings', () => ({ saveSettingsAction: save }))

import { R2Account } from './r2-account'
import { accountSaveState } from './account-settings-model'

const BUSINESS = Object.freeze({
  businessName: '바이름',
  industry: '뷰티',
  location: '서울 성수',
  summary: '예약제로 운영합니다.',
})

afterEach(() => {
  save.mockReset()
})

describe('R2 설정 화면(ANI-1771)', () => {
  it('서버 정본 설정값을 그대로 보여 준다', () => {
    render(<R2Account settings={{ ok: true, business: BUSINESS, canEdit: true }} />)

    expect((screen.getByLabelText('사업명') as HTMLInputElement).value).toBe('바이름')
    expect((screen.getByLabelText('업종') as HTMLInputElement).value).toBe('뷰티')
    expect((screen.getByLabelText('위치') as HTMLInputElement).value).toBe('서울 성수')
    expect((screen.getByLabelText('운영 요약') as HTMLTextAreaElement).value).toBe('예약제로 운영합니다.')
  })

  it('읽지 못한 경우 빈 사업 정보가 아니라 오류로 보인다', () => {
    render(<R2Account settings={{ ok: false }} />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('가게 정보를 불러오지 못했어요')).toBeVisible()
    expect(screen.queryByLabelText('사업명')).toBeNull()
  })

  it('저장은 기존 서버 명령 계약(saveSettingsAction business)만 호출한다', async () => {
    save.mockResolvedValue({ ok: true, message: '사업 정보를 저장했어요.' })
    render(<R2Account settings={{ ok: true, business: BUSINESS, canEdit: true }} />)

    fireEvent.change(screen.getByLabelText('사업명'), { target: { value: '바이름 성수점' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    expect(screen.getByText('사업 정보를 저장했어요.')).toBeVisible()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({
      kind: 'business',
      businessName: '바이름 성수점',
      industry: '뷰티',
      location: '서울 성수',
      summary: '예약제로 운영합니다.',
    })
  })

  it('서버가 거부하면 성공 문구를 쓰지 않고 오류로 보여 준다', async () => {
    save.mockResolvedValue({ ok: false, code: 'FORBIDDEN', message: '이 설정을 변경할 권한이 없어요.' })
    render(<R2Account settings={{ ok: true, business: BUSINESS, canEdit: true }} />)

    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByText('이 설정을 변경할 권한이 없어요.')).toBeVisible()
    expect(screen.queryByText('사업 정보를 저장했어요.')).toBeNull()
  })

  it('저장 권한이 없으면 입력과 저장 버튼을 열지 않는다', () => {
    render(<R2Account settings={{ ok: true, business: BUSINESS, canEdit: false }} />)

    expect(screen.getByLabelText('사업명')).toBeDisabled()
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull()
    expect(screen.getByText(/볼 수만 있어요/)).toBeVisible()
  })

  it('필드 오류 문구를 함께 보여 준다', () => {
    const state = accountSaveState({
      ok: false,
      code: 'INVALID_INPUT',
      message: '입력한 내용을 확인해 주세요.',
      fieldErrors: { businessName: ['사업명을 입력해 주세요.'] },
    })
    expect(state.tone).toBe('error')
    expect(state.message).toBe('입력한 내용을 확인해 주세요. 사업명을 입력해 주세요.')
  })
})

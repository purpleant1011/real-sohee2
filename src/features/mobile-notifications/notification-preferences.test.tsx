import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationPreferences } from './notification-preferences'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const savePreferences = vi.fn()
vi.mock('@/features/notifications/actions/manage-notifications', () => ({
  saveNotificationPreferencesAction: (input: unknown) => savePreferences(input),
}))

const ALL_ON = { approvalEvents: true, scheduleEvents: true, publishEvents: true }

beforeEach(() => {
  refresh.mockClear()
  savePreferences.mockReset()
})

describe('NotificationPreferences (M23 R2)', () => {
  it('서버가 준 설정을 그대로 표시하고, 바뀐 것이 없으면 저장하지 않는다', () => {
    render(<NotificationPreferences preferences={{ ...ALL_ON, scheduleEvents: false }} />)

    expect(screen.getByRole('switch', { name: '승인 요청' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: '예약·일정' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('button', { name: '저장된 설정이에요' })).toBeDisabled()
    expect(savePreferences).not.toHaveBeenCalled()
  })

  it('바꾼 값 전체를 서버로 보내고, 서버가 저장한 뒤에만 저장됨을 표시한다', async () => {
    savePreferences.mockResolvedValue({ data: { saved: true } })
    render(<NotificationPreferences preferences={ALL_ON} />)

    fireEvent.click(screen.getByRole('switch', { name: '게시 결과' }))
    expect(screen.getByRole('switch', { name: '게시 결과' })).toHaveAttribute('aria-checked', 'false')
    // 저장 전에는 저장됐다고 말하지 않는다.
    expect(screen.queryByText('알림 설정을 저장했어요.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '알림 설정 저장' }))

    await waitFor(() => expect(screen.getByText('알림 설정을 저장했어요.')).toBeVisible())
    expect(savePreferences).toHaveBeenCalledWith({ approvalEvents: true, scheduleEvents: true, publishEvents: false })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('저장 실패는 서버 문구로 알리고 저장됐다고 하지 않는다', async () => {
    savePreferences.mockResolvedValue({ error: { message: '알림 설정을 저장하지 못했습니다.', requestId: 'notification-preferences' } })
    render(<NotificationPreferences preferences={ALL_ON} />)

    fireEvent.click(screen.getByRole('switch', { name: '승인 요청' }))
    fireEvent.click(screen.getByRole('button', { name: '알림 설정 저장' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('알림 설정을 저장하지 못했습니다.')
    expect(screen.queryByText('알림 설정을 저장했어요.')).toBeNull()
    expect(refresh).not.toHaveBeenCalled()
  })
})

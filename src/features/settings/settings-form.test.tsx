import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  BrandSettingsForm,
  BusinessSettingsForm,
  ChannelSettingsForm,
  MemberSettingsList,
} from './settings-form'

vi.mock('./actions/save-settings', () => ({ saveSettingsAction: vi.fn() }))
vi.mock('@/features/channels/actions/disconnect-channel', () => ({ disconnectChannelAction: vi.fn() }))

describe('operational settings forms', () => {
  it('restores unsaved business changes on cancel', () => {
    render(<BusinessSettingsForm
      canEdit
      value={{ businessName: '기존 사업명', industry: '카페', location: '서울', summary: '기존 요약' }}
    />)

    const name = screen.getByLabelText('사업명')
    fireEvent.change(name, { target: { value: '저장하지 않은 이름' } })
    expect(name).toHaveValue('저장하지 않은 이름')
    fireEvent.click(screen.getByRole('button', { name: '변경 취소' }))
    expect(name).toHaveValue('기존 사업명')
  })

  it('shows brand fields as read only to viewers without hiding the saved basis', () => {
    render(<BrandSettingsForm
      canEdit={false}
      value={{ voice: '친절하게', keywords: ['수제'], prohibitedTerms: ['무조건'] }}
    />)

    expect(screen.getByLabelText('말투')).toHaveValue('친절하게')
    expect(screen.getByLabelText('말투')).toBeDisabled()
    expect(screen.queryByRole('button', { name: '브랜드 기준 저장' })).not.toBeInTheDocument()
  })

  it('offers real OAuth only for supported Meta channels and labels unsupported channels honestly', () => {
    render(<ChannelSettingsForm
      canEdit
      channels={[
        { channel: 'instagram', status: 'disconnected', accountLabel: null, tokenExpiresAt: null, webhookStatus: 'pending', lastWebhookAt: null, lastErrorCode: null },
        { channel: 'threads', status: 'provider_error', accountLabel: '@sohee', tokenExpiresAt: null, webhookStatus: 'error', lastWebhookAt: null, lastErrorCode: 'PROVIDER_ERROR' },
        { channel: 'naver_blog', status: 'disconnected', accountLabel: null, tokenExpiresAt: null, webhookStatus: 'pending', lastWebhookAt: null, lastErrorCode: null },
      ]}
    />)

    expect(screen.getAllByText('연결되지 않음').length).toBeGreaterThan(0)
    expect(screen.getByText('채널 오류')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Instagram 공식 계정 연결' })).toHaveAttribute('href', '/api/channels/instagram/connect')
    expect(screen.getByText('이번 운영 연동 범위에는 포함되지 않은 채널입니다.')).toBeInTheDocument()
  })

  it('renders safe member labels and owner-only controls without visible UUIDs', () => {
    render(<MemberSettingsList
      canEdit
      members={[{
        memberId: '10000000-0000-4000-8000-000000000001',
        label: '나',
        role: 'owner',
        status: 'active',
        current: true,
      }]}
    />)

    expect(screen.getByText('나')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '멤버 권한 저장' })).toBeEnabled()
    expect(document.body).not.toHaveTextContent('10000000-0000-4000-8000-000000000001')
  })
})

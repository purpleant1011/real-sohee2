import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NaverConnectorInstallCard } from './naver-connector-install-card'

describe('NaverConnectorInstallCard', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111'

  it('renders notice card explaining manual publishing support without install prompt or ZIP download', () => {
    render(<NaverConnectorInstallCard workspaceId={workspaceId} />)

    expect(
      screen.getByText('소희는 네이버 자동 게시를 하지 않아요. 글·사진을 준비해 드리고 직접 올리실 수 있게 도와요'),
    ).toBeInTheDocument()

    // No download link or installation triggers
    expect(screen.queryByText(/ZIP/)).not.toBeInTheDocument()
    expect(screen.queryByText(/확장.*설치/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /연결 상태 확인/ })).not.toBeInTheDocument()
  })
})

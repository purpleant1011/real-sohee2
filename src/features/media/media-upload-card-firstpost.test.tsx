import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MediaUploadCard } from './media-upload-card'
afterEach(() => vi.unstubAllGlobals())
describe('첫 게시 실사진 필수 경로', () => {
  it('사진이 필수인 경로에서는 미연결 AI 생성 선택으로 보내지 않는다', () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [] })))
    render(<MediaUploadCard workspaceId="local-workspace" requirePhoto />)
    expect(screen.getByText('(필수)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '원본 사진 없이 새 시안 만들기' })).toBeNull()
  })
})

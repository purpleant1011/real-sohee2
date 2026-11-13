import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sampleFixtures } from '@/app/dev/vault-board/samples'
import { createStaticVaultFetch } from './static-vault-api'
import { VaultBundleDialog } from './vault-bundle-dialog'

// The development board uses fixtures for both reads and writes. A POST must never escape to the real API.
afterEach(() => vi.unstubAllGlobals())

describe('보관함 복사 창', () => {
  it('샘플 게시 주소 등록 시 네트워크로 요청하지 않고 읽기 전용 안내를 보여준다', async () => {
    const network = vi.fn(() => { throw new Error('실제 API 호출') })
    vi.stubGlobal('fetch', network)
    render(<VaultBundleDialog workspaceId="preview" itemRef="sample-two" channelLabel="네이버 블로그" open onOpenChange={() => {}} fetchFn={createStaticVaultFetch(sampleFixtures)} />)
    fireEvent.change(await screen.findByLabelText('게시 완료된 글 주소'), { target: { value: 'https://blog.naver.com/test/123' } })
    fireEvent.click(screen.getByRole('button', { name: '게시 주소 등록하기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('미리보기 샘플이라 저장되지 않아요.')
    await waitFor(() => expect(network).not.toHaveBeenCalled())
  })
})

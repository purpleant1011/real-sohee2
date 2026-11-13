import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ManualHandoffPanel } from './manual-handoff-panel'

const props = { workspaceId: 'workspace-a', contentId: 'content-a', versionId: 'version-a', channel: 'threads' as const }
const empty = { state: 'NOT_RECORDED', label: '수동 전달 기록 없음 · 외부 게시 전', source: null, providerVerified: false, recordedAt: null }
const delivered = { state: 'MANUAL_DELIVERED', label: '수동 전달 완료 · 게시 미확인', source: 'OWNER_REPORTED', providerVerified: false, recordedAt: '2026-10-21T00:00:00Z' }

describe('manual handoff report panel', () => {
  it('requires explicit confirmation and displays only the durable owner-reported result', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => Response.json(options?.method === 'POST' ? delivered : empty)) as unknown as typeof fetch
    render(<ManualHandoffPanel {...props} fetcher={fetcher} />)
    const button = await screen.findByRole('button', { name: '수동 전달로 기록' })
    expect(button).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: '원고와 사진을 확인하고 직접 전달했어요' }))
    fireEvent.click(button)
    expect(await screen.findByText('수동 전달 완료 · 게시 미확인')).toBeInTheDocument()
    expect(screen.getByText('사장님이 알려주신 기록이며, 실제 게시 여부를 확인한 것은 아니에요.')).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledWith('/api/first-value/handoff', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ contentId: props.contentId, versionId: props.versionId, channel: 'threads', confirmed: true }),
    }))
  })

  it('restores a persisted report on a fresh page without prompting for another submission', async () => {
    const fetcher = vi.fn(async () => Response.json(delivered)) as unknown as typeof fetch
    render(<ManualHandoffPanel {...props} fetcher={fetcher} />)
    expect(await screen.findByText('수동 전달 완료 · 게시 미확인')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '수동 전달로 기록' })).not.toBeInTheDocument()
    expect((fetcher as any).mock.calls.every(([, options]: [unknown, RequestInit]) => options.method !== 'POST')).toBe(true)
  })

  it('does not display a failed read as no record', async () => {
    const fetcher = vi.fn(async () => Response.json({ error: '기록을 조회하지 못했어요.' }, { status: 503 })) as unknown as typeof fetch
    render(<ManualHandoffPanel {...props} fetcher={fetcher} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('기록을 조회하지 못했어요.')
    expect(screen.queryByText('수동 전달 기록 없음 · 외부 게시 전')).not.toBeInTheDocument()
  })
})

describe('naver post address after a manual handoff', () => {
  const naver = { ...props, channel: 'naver_blog' as const }
  it('offers the address form only for a delivered naver report that carries its item id', async () => {
    const fetcher = vi.fn(async () => Response.json({ ...delivered, itemId: '11111111-1111-4111-8111-111111111111' })) as unknown as typeof fetch
    const { unmount } = render(<ManualHandoffPanel {...naver} fetcher={fetcher} />)
    expect(await screen.findByLabelText('올린 글 주소')).toBeInTheDocument()
    unmount()
    render(<ManualHandoffPanel {...props} fetcher={vi.fn(async () => Response.json({ ...delivered, itemId: '11111111-1111-4111-8111-111111111111' })) as unknown as typeof fetch} />)
    await screen.findByText('수동 전달 완료 · 게시 미확인')
    expect(screen.queryByLabelText('올린 글 주소')).not.toBeInTheDocument()
  })

  it('does not offer it before the report exists', async () => {
    render(<ManualHandoffPanel {...naver} fetcher={vi.fn(async () => Response.json({ ...empty, itemId: '11111111-1111-4111-8111-111111111111' })) as unknown as typeof fetch} />)
    await screen.findByRole('button', { name: '수동 전달로 기록' })
    expect(screen.queryByLabelText('올린 글 주소')).not.toBeInTheDocument()
  })
})

describe('saving the version to the vault before reporting (naver blog)', () => {
  const naver = { ...props, channel: 'naver_blog' as const, allowVaultSave: true }
  const needSave = () => Response.json({ error: '보관한 내용을 다시 확인해 주세요.', code: 'VAULT_ITEM_REQUIRED' }, { status: 409 })

  it('asks for an explicit confirmation, saves once, then shows the report form', async () => {
    let saved = false
    const calls: string[] = []
    const fetcher = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
      calls.push(`${options?.method ?? 'GET'} ${String(url).split('?')[0]}`)
      if (String(url).startsWith('/api/workspaces/workspace-a/vault')) { saved = true; return Response.json({ saved: [{ channel: 'naver_blog' }], rejected: [], external_posts: 0 }) }
      return saved ? Response.json(empty) : needSave()
    }) as unknown as typeof fetch
    render(<ManualHandoffPanel {...naver} fetcher={fetcher} />)
    const button = await screen.findByRole('button', { name: '이 버전을 보관하고 기록 시작' })
    expect(button).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /이 버전을 승인해 보관해요/ }))
    fireEvent.click(button)
    expect(await screen.findByRole('button', { name: '수동 전달로 기록' })).toBeInTheDocument()
    expect(calls.filter(call => call.startsWith('POST /api/workspaces/workspace-a/vault'))).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledWith('/api/workspaces/workspace-a/vault', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ contentId: props.contentId, versionId: props.versionId, channels: ['naver_blog'], idempotencyKey: `blog-manual:${props.versionId}` }),
    }))
  })

  it('keeps the photo requirement: shows the server rejection and never offers the report', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).startsWith('/api/workspaces/')
      ? Response.json({ saved: [], rejected: [{ channel: 'naver_blog', reason_label: '네이버 블로그는 제목과 이미지가 필요해요' }], external_posts: 0 })
      : needSave()) as unknown as typeof fetch
    render(<ManualHandoffPanel {...naver} fetcher={fetcher} />)
    fireEvent.click(await screen.findByRole('checkbox', { name: /이 버전을 승인해 보관해요/ }))
    fireEvent.click(screen.getByRole('button', { name: '이 버전을 보관하고 기록 시작' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('네이버 블로그는 제목과 이미지가 필요해요')
    expect(screen.queryByRole('button', { name: '수동 전달로 기록' })).not.toBeInTheDocument()
  })

  it('does not offer saving unless the caller allows it', async () => {
    render(<ManualHandoffPanel {...props} channel="naver_blog" fetcher={vi.fn(async () => needSave()) as unknown as typeof fetch} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('보관한 내용을 다시 확인해 주세요.')
    expect(screen.queryByRole('button', { name: '이 버전을 보관하고 기록 시작' })).not.toBeInTheDocument()
  })
})

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'

/**
 * 셸의 CTA 계약(label·disabled·disabledReason·onPress)만 그대로 그려 화면의 배선을 본다.
 * 실제 고정 CTA 렌더는 셸 테스트 몫이다.
 */
vi.mock('@/features/mobile-shell', () => ({
  ShellScreen: ({ cta }: { cta?: { label: string; onPress?: () => void; disabled?: boolean; disabledReason?: string } }) =>
    cta ? (
      <div>
        {cta.disabled && cta.disabledReason ? <p>{cta.disabledReason}</p> : null}
        <button type="button" disabled={cta.disabled} onClick={cta.onPress}>
          {cta.label}
        </button>
      </div>
    ) : null,
}))

const approve = vi.hoisted(() => vi.fn())

vi.mock('@/features/approvals/actions/approve-and-dispatch', () => ({
  approveAndDispatchAction: (...args: unknown[]) => approve(...args),
}))

import { R2WorkApprove, workApproveSubmitInput, workPublishSubmitInput } from './r2-work-approve'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const CONTENT_ID = '22222222-2222-4222-8222-222222222222'
const VERSION_ID = '33333333-3333-4333-8333-333333333333'
const FINGERPRINT = 'a'.repeat(64)

const SNAPSHOT: ApprovalPreviewSnapshot = {
  workspaceId: WORKSPACE_ID,
  contentId: CONTENT_ID,
  versionId: VERSION_ID,
  versionNumber: 3,
  fingerprint: FINGERPRINT,
  approval: { id: null, status: 'unreviewed', fingerprint: null },
  channel: 'instagram',
  account: { connectionId: 'conn-1', label: '@sohee', status: 'connected' },
  caption: '본문',
  hashtags: [],
  disclosure: '',
  text: '본문',
  media: [],
  issues: [],
}

const SNAPSHOT_NAVER: ApprovalPreviewSnapshot = {
  ...SNAPSHOT,
  channel: 'naver_blog',
  caption: '네이버 블로그 본문',
  text: '네이버 블로그 본문',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('M07 게시 전 최종 확인 화면 (ANI-1680)', () => {
  beforeEach(() => {
    approve.mockReset()
    approve.mockResolvedValue({ error: null })
  })

  it('서버 명령 경계는 승인 기록 하나뿐이다(게시·예약 값은 비운다)', () => {
    expect(workApproveSubmitInput(WORKSPACE_ID, CONTENT_ID, SNAPSHOT)).toEqual({
      workspaceId: WORKSPACE_ID,
      contentId: CONTENT_ID,
      versionId: VERSION_ID,
      fingerprint: FINGERPRINT,
      mode: 'approve_only',
      channelConnectionId: null,
      scheduledLocal: null,
      timezone: null,
    })
  })

  it('승인을 누르면 승인 기록만 보내고 결과를 서버 응답 뒤에 표시한다', async () => {
    render(<R2WorkApprove workspaceId={WORKSPACE_ID} contentId={CONTENT_ID} role="owner" snapshot={SNAPSHOT} />)

    fireEvent.click(screen.getByRole('button', { name: '승인' }))

    expect((await screen.findAllByText(/승인이 기록됐어요/)).length).toBeGreaterThan(0)
    expect(approve).toHaveBeenCalledTimes(1)
    expect(approve).toHaveBeenCalledWith(workApproveSubmitInput(WORKSPACE_ID, CONTENT_ID, SNAPSHOT))
    // 메타 채널은 승인 성공 후 즉시 '지금 게시 요청'으로 전환된다
    await waitFor(() => expect(screen.getByRole('button', { name: '지금 게시 요청' })).not.toBeDisabled())
  })

  it('서버 응답 전에는 승인된 것처럼 표시하지 않는다', async () => {
    const pending = deferred<{ error: null }>()
    approve.mockReturnValue(pending.promise)
    render(<R2WorkApprove workspaceId={WORKSPACE_ID} contentId={CONTENT_ID} role="owner" snapshot={SNAPSHOT} />)

    fireEvent.click(screen.getByRole('button', { name: '승인' }))

    expect(screen.getByRole('button', { name: '기록하는 중' })).toBeDisabled()
    expect(screen.queryByText(/승인이 기록됐어요/)).toBeNull()

    pending.resolve({ error: null })
    expect((await screen.findAllByText(/승인이 기록됐어요/)).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.getByRole('button', { name: '지금 게시 요청' })).not.toBeDisabled())
  })

  it('두 번 눌러도 승인 요청은 한 번만 나간다', async () => {
    const pending = deferred<{ error: null }>()
    approve.mockReturnValue(pending.promise)
    render(<R2WorkApprove workspaceId={WORKSPACE_ID} contentId={CONTENT_ID} role="owner" snapshot={SNAPSHOT} />)

    const button = screen.getByRole('button', { name: '승인' })
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1))
    pending.resolve({ error: null })
    await waitFor(() => expect(screen.getByRole('button', { name: '지금 게시 요청' })).not.toBeDisabled())
  })

  it('서버가 거절하면 승인된 것으로 바꾸지 않고 사유를 보여 준다', async () => {
    approve.mockResolvedValue({ error: { message: '이미 바뀐 내용이에요.', requestId: 'approve-and-dispatch' } })
    render(<R2WorkApprove workspaceId={WORKSPACE_ID} contentId={CONTENT_ID} role="owner" snapshot={SNAPSHOT} />)

    fireEvent.click(screen.getByRole('button', { name: '승인' }))

    await screen.findByText('이미 바뀐 내용이에요. 승인된 것은 없어요.')
    // 다시 시도할 수 있어야 한다 — 실패를 잠금으로 바꾸지 않는다.
    // 메시지와 함께 transition 이 끝나는 시점은 한 틱 다를 수 있어 정착을 기다린다.
    await waitFor(() => expect(screen.getByRole('button', { name: '승인' })).not.toBeDisabled())
    expect(screen.queryByRole('button', { name: '승인 기록됨' })).toBeNull()
  })

  it('확인 항목을 불러오지 못하면 승인 버튼을 열지 않고 조회 실패를 말한다', () => {
    render(<R2WorkApprove workspaceId={WORKSPACE_ID} contentId={CONTENT_ID} role="owner" snapshot={null} />)

    expect(screen.getByRole('status').textContent).toContain('확인 항목을 불러오지 못했어요')
    expect(screen.getByRole('button', { name: '내용을 확인해 주세요' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '내용을 확인해 주세요' }))
    expect(approve).not.toHaveBeenCalled()
  })

  it('승인 권한이 없는 역할은 사유와 함께 잠긴다', () => {
    render(<R2WorkApprove workspaceId={WORKSPACE_ID} contentId={CONTENT_ID} role="viewer" snapshot={SNAPSHOT} />)

    expect(screen.getByRole('button', { name: '승인 준비 확인 필요' })).toBeDisabled()
    expect(screen.getByText(/승인 권한이 없어요/)).toBeTruthy()
  })

  it('빈칸이 남아있으면 기본적으로 승인 버튼이 비활성화되고, 체크박스를 체크하면 활성화된다 (soft gate)', async () => {
    const snapshotWithPlaceholders: ApprovalPreviewSnapshot = {
      ...SNAPSHOT,
      caption: '봄맞이 이벤트 안내\n기간: [이벤트 기간]',
      hashtags: ['#이벤트', '[매장명 입력]'],
      text: '봄맞이 이벤트 안내\n기간: [이벤트 기간]\n\n#이벤트 [매장명 입력]',
    }

    render(<R2WorkApprove workspaceId={WORKSPACE_ID} contentId={CONTENT_ID} role="owner" snapshot={snapshotWithPlaceholders} />)

    expect(screen.getByText('채워야 할 곳이 2개 있어요')).toBeInTheDocument()
    expect(screen.getByText('[이벤트 기간]')).toBeInTheDocument()
    expect(screen.getByText('[매장명 입력]')).toBeInTheDocument()

    const button = screen.getByRole('button', { name: '승인' })
    expect(button).toBeDisabled()
    expect(screen.getByText('채워지지 않은 빈칸이 있어요. 빈칸이 있어도 승인하려면 아래 확인을 체크해 주세요.')).toBeInTheDocument()

    fireEvent.click(button)
    expect(approve).not.toHaveBeenCalled()

    const checkbox = screen.getByRole('checkbox', { name: '빈칸이 있어도 이대로 승인할게요' })
    expect(checkbox).not.toBeChecked()

    fireEvent.click(checkbox)
    expect(button).not.toBeDisabled()

    fireEvent.click(button)
    expect((await screen.findAllByText(/승인이 기록됐어요/)).length).toBeGreaterThan(0)
    expect(approve).toHaveBeenCalledTimes(1)
    // 빈칸이 남은 상태에서는 승인 우회는 되었으나 실제 전송은 차단된다
    await waitFor(() => expect(screen.getByRole('button', { name: '지금 게시 요청' })).toBeDisabled())
  })

  it('HARD gate: info-request caption completely locks approval and hides soft-gate checkbox', () => {
    const infoRequestSnapshot: ApprovalPreviewSnapshot = {
      ...SNAPSHOT,
      caption:
        '이벤트 문안을 작성하기 전에 몇 가지 정보를 확인해 주세요.\n\n이벤트명, 진행 기간, 대상, 제공 혜택, 참여 방법을 알려주시면 바이름 청라점의 따뜻하고 세련된 말투에 맞춰 작성해 드려요.',
      text: '이벤트 문안을 작성하기 전에 몇 가지 정보를 확인해 주세요.\n\n이벤트명, 진행 기간, 대상, 제공 혜택, 참여 방법을 알려주시면 바이름 청라점의 따뜻하고 세련된 말투에 맞춰 작성해 드려요.',
    }

    render(
      <R2WorkApprove
        workspaceId={WORKSPACE_ID}
        contentId={CONTENT_ID}
        role="owner"
        snapshot={infoRequestSnapshot}
      />,
    )

    // Distinct notice shown
    expect(
      screen.getByText('고객에게 보여줄 글이 아니라 소희의 정보 요청이에요.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('이벤트 정보를 알려주고 다시 만들어 주세요.'),
    ).toBeInTheDocument()

    // Button disabled with distinct info-request reason
    const button = screen.getByRole('button', { name: '승인' })
    expect(button).toBeDisabled()
    expect(
      screen.getByText(
        '고객에게 보여줄 글이 아니라 소희의 정보 요청이에요. 이벤트 정보를 알려주고 다시 만들어 주세요.',
      ),
    ).toBeInTheDocument()

    // Soft gate override checkbox must NOT be rendered
    expect(
      screen.queryByRole('checkbox', { name: '빈칸이 있어도 이대로 승인할게요' }),
    ).not.toBeInTheDocument()

    fireEvent.click(button)
    expect(approve).not.toHaveBeenCalled()
  })

  it('네이버 블로그 채널은 승인 전 문구가 게시 준비 승인/준비된 원고/이 원고로 게시 준비 승인으로 표시된다', () => {
    render(
      <R2WorkApprove
        workspaceId={WORKSPACE_ID}
        contentId={CONTENT_ID}
        role="owner"
        snapshot={SNAPSHOT_NAVER}
      />,
    )

    expect(screen.getByRole('heading', { level: 1, name: '게시 준비 승인' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '준비된 원고' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이 원고로 게시 준비 승인' })).toBeInTheDocument()
    expect(screen.queryByText('게시할 내용')).not.toBeInTheDocument()
  })

  it('네이버 블로그 채널은 승인 후 성공 메시지와 원고 복사하러 가기 보조 링크가 표시된다', async () => {
    render(
      <R2WorkApprove
        workspaceId={WORKSPACE_ID}
        contentId={CONTENT_ID}
        role="owner"
        snapshot={SNAPSHOT_NAVER}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '이 원고로 게시 준비 승인' }))

    expect((await screen.findAllByText('승인이 기록됐어요. 이제 복사·사진 저장 후 네이버에서 직접 게시해 주세요.')).length).toBeGreaterThan(0)
    expect(approve).toHaveBeenCalledTimes(1)
    expect(approve).toHaveBeenCalledWith(workApproveSubmitInput(WORKSPACE_ID, CONTENT_ID, SNAPSHOT_NAVER))

    const link = screen.getByRole('link', { name: '원고 복사하러 가기' })
    expect(link).toHaveAttribute('href', `/app/work/${CONTENT_ID}`)
    expect(screen.queryByText(/게시는 다음 단계에서 확인해요/)).not.toBeInTheDocument()
  })

  it('인스타그램 등 타 채널은 기존 승인 문구와 다음 단계 안내가 유지되고 보조 링크가 없다', async () => {
    render(
      <R2WorkApprove
        workspaceId={WORKSPACE_ID}
        contentId={CONTENT_ID}
        role="owner"
        snapshot={SNAPSHOT}
      />,
    )

    expect(screen.getByRole('heading', { level: 1, name: '게시 전 최종 확인' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '게시할 내용' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '승인' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '승인' }))

    expect((await screen.findAllByText(/승인이 기록됐어요/)).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: '원고 복사하러 가기' })).not.toBeInTheDocument()
  })

  it('헤더 뱃지에 shrink-0 whitespace-nowrap이 적용되고 제목에 break-keep이 적용된다', () => {
    render(
      <R2WorkApprove
        workspaceId={WORKSPACE_ID}
        contentId={CONTENT_ID}
        role="owner"
        snapshot={SNAPSHOT}
      />,
    )
    const channelBadge = screen.getByText('Instagram')
    expect(channelBadge.className).toContain('shrink-0')
    expect(channelBadge.className).toContain('whitespace-nowrap')

    const heading = screen.getByRole('heading', { level: 1, name: '게시 전 최종 확인' })
    expect(heading.className).toContain('break-keep')
  })

  it('같은화면승인후명시적게시CTA전환: 승인 성공 후 동일 화면에서 CTA가 즉시 "지금 게시 요청"으로 전환된다', async () => {
    render(
      <R2WorkApprove
        workspaceId={WORKSPACE_ID}
        contentId={CONTENT_ID}
        role="owner"
        snapshot={SNAPSHOT}
      />,
    )

    // 1. 처음엔 '승인' 버튼
    const approveBtn = screen.getByRole('button', { name: '승인' })
    fireEvent.click(approveBtn)

    // 2. 승인 성공 후 화면 리로드 없이도 즉시 '지금 게시 요청' 버튼으로 전환되어야 함 (dead-end 탈출)
    const publishBtn = await screen.findByRole('button', { name: '지금 게시 요청' })
    expect(publishBtn).not.toBeDisabled()

    // 3. '지금 게시 요청' 클릭 시 publish_now 디스패치
    approve.mockResolvedValueOnce({
      data: {
        approvalId: 'appr-1',
        versionId: VERSION_ID,
        next: 'published',
        scheduleId: 'sch-1',
        attemptId: 'att-1',
        providerPostId: 'ig-post-1',
        errorCode: null,
      },
    })
    fireEvent.click(publishBtn)

    await waitFor(() => expect(approve).toHaveBeenCalledTimes(2))
    expect(approve).toHaveBeenLastCalledWith(workPublishSubmitInput(WORKSPACE_ID, CONTENT_ID, SNAPSHOT))
    expect(await screen.findByRole('button', { name: '게시 요청 접수됨' })).toBeDisabled()
  })

  it('publish_now 결과가 failed면 safe 오류 메시지와 함께 재시도가 차단된다', async () => {
    const approvedSnapshot: ApprovalPreviewSnapshot = {
      ...SNAPSHOT,
      approval: { id: 'appr-1', status: 'approved', fingerprint: FINGERPRINT },
    }

    approve.mockResolvedValueOnce({
      data: {
        approvalId: 'appr-1',
        versionId: VERSION_ID,
        next: 'failed',
        scheduleId: 'sch-1',
        attemptId: 'att-1',
        providerPostId: null,
        errorCode: 'PROVIDER_AUTH_EXPIRED',
      },
    })

    render(
      <R2WorkApprove
        workspaceId={WORKSPACE_ID}
        contentId={CONTENT_ID}
        role="owner"
        snapshot={approvedSnapshot}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '지금 게시 요청' }))

    expect(await screen.findByText('게시 요청을 완료하지 못했어요. 작업 상세에서 원인을 확인해 주세요.')).toBeInTheDocument()
    expect(screen.queryByText(/PROVIDER_AUTH_EXPIRED/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '게시 실패' })).toBeDisabled()
  })

  it('publish_now 결과가 unknown이면 중복 요청을 차단하고 작업 상세 확인을 안내한다', async () => {
    const approvedSnapshot: ApprovalPreviewSnapshot = {
      ...SNAPSHOT,
      approval: { id: 'appr-1', status: 'approved', fingerprint: FINGERPRINT },
    }

    approve.mockResolvedValueOnce({
      data: {
        approvalId: 'appr-1',
        versionId: VERSION_ID,
        next: 'unknown',
        scheduleId: 'sch-1',
        attemptId: null,
        providerPostId: null,
        errorCode: null,
      },
    })

    render(
      <R2WorkApprove
        workspaceId={WORKSPACE_ID}
        contentId={CONTENT_ID}
        role="owner"
        snapshot={approvedSnapshot}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '지금 게시 요청' }))

    expect(await screen.findByText(/게시 요청 결과를 명확히 확인하지 못했어요/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '게시 상태 확인 필요' })).toBeDisabled()
  })

  it('publish_now 결과가 scheduled면 예약 접수 메시지와 함께 확인 중 상태를 안내한다', async () => {
    const approvedSnapshot: ApprovalPreviewSnapshot = {
      ...SNAPSHOT,
      approval: { id: 'appr-1', status: 'approved', fingerprint: FINGERPRINT },
    }

    approve.mockResolvedValueOnce({
      data: {
        approvalId: 'appr-1',
        versionId: VERSION_ID,
        next: 'scheduled',
        scheduleId: 'sch-1',
        attemptId: null,
        providerPostId: null,
        errorCode: null,
      },
    })

    render(
      <R2WorkApprove
        workspaceId={WORKSPACE_ID}
        contentId={CONTENT_ID}
        role="owner"
        snapshot={approvedSnapshot}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '지금 게시 요청' }))

    expect(await screen.findByText(/게시 요청이 서버에 접수되어 처리 대기 중이에요/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '게시 대기 중' })).toBeDisabled()
  })

  it('publish_now 통신 중 throw가 발생해도 미전송으로 단정하지 않고 unknown 처리하여 중복 요청을 차단한다', async () => {
    const approvedSnapshot: ApprovalPreviewSnapshot = {
      ...SNAPSHOT,
      approval: { id: 'appr-1', status: 'approved', fingerprint: FINGERPRINT },
    }

    approve.mockRejectedValueOnce(new Error('Network transport dropped'))

    render(
      <R2WorkApprove
        workspaceId={WORKSPACE_ID}
        contentId={CONTENT_ID}
        role="owner"
        snapshot={approvedSnapshot}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '지금 게시 요청' }))

    expect(await screen.findByText(/통신 오류로 게시 요청 결과를 확인하지 못했어요/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '게시 상태 확인 필요' })).toBeDisabled()
  })

  it('snapshot의 versionId가 변경되면 로컬 승인 및 게시 상태가 초기화된다', async () => {
    const { rerender } = render(
      <R2WorkApprove
        workspaceId={WORKSPACE_ID}
        contentId={CONTENT_ID}
        role="owner"
        snapshot={SNAPSHOT}
      />,
    )

    // 승인 실행
    fireEvent.click(screen.getByRole('button', { name: '승인' }))
    expect(await screen.findByRole('button', { name: '지금 게시 요청' })).not.toBeDisabled()

    // 버전 변경 snapshot으로 rerender
    const newVersionSnapshot: ApprovalPreviewSnapshot = {
      ...SNAPSHOT,
      versionId: '44444444-4444-4444-4444-444444444444',
      versionNumber: 4,
      fingerprint: 'f'.repeat(64),
      approval: { id: null, status: 'unreviewed', fingerprint: null },
    }

    rerender(
      <R2WorkApprove
        workspaceId={WORKSPACE_ID}
        contentId={CONTENT_ID}
        role="owner"
        snapshot={newVersionSnapshot}
      />,
    )

    // 새로운 버전에서는 승인 상태가 초기화되어 다시 '승인' 버튼이 노출되어야 함
    expect(screen.getByRole('button', { name: '승인' })).not.toBeDisabled()
  })

  it('이미 승인된 메타 채널은 "지금 게시 요청" 버튼이 렌더링되고 클릭 시 publish_now를 호출한다', async () => {
    const approvedSnapshot: ApprovalPreviewSnapshot = {
      ...SNAPSHOT,
      approval: { id: 'appr-1', status: 'approved', fingerprint: FINGERPRINT },
    }

    approve.mockResolvedValueOnce({
      data: {
        approvalId: 'appr-1',
        versionId: VERSION_ID,
        next: 'published',
        scheduleId: 'sch-1',
        attemptId: 'att-1',
        providerPostId: 'ig-post-1',
        errorCode: null,
      },
    })

    render(
      <R2WorkApprove
        workspaceId={WORKSPACE_ID}
        contentId={CONTENT_ID}
        role="owner"
        snapshot={approvedSnapshot}
      />,
    )

    const publishButton = screen.getByRole('button', { name: '지금 게시 요청' })
    expect(publishButton).not.toBeDisabled()

    fireEvent.click(publishButton)

    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1))
    expect(approve).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      contentId: CONTENT_ID,
      versionId: VERSION_ID,
      fingerprint: FINGERPRINT,
      mode: 'publish_now',
      channelConnectionId: 'conn-1',
      scheduledLocal: null,
      timezone: null,
    })

    expect((await screen.findAllByText('게시 요청이 접수되었어요. 공식 채널에서 게시 확인 중이에요.')).length).toBeGreaterThan(0)
    expect(screen.queryByText(/게시 완료/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '게시 요청 접수됨' })).toBeDisabled()
    expect(screen.getByRole('link', { name: '작업 상세로 돌아가기' })).toHaveAttribute('href', `/app/work/${CONTENT_ID}`)
  })

  it('publish_now 결과가 published라도 providerPostId가 없으면 완료를 단정하지 않고 unknown 처리한다', async () => {
    const approvedSnapshot: ApprovalPreviewSnapshot = {
      ...SNAPSHOT,
      approval: { id: 'appr-1', status: 'approved', fingerprint: FINGERPRINT },
    }

    approve.mockResolvedValueOnce({
      data: {
        approvalId: 'appr-1',
        versionId: VERSION_ID,
        next: 'published',
        scheduleId: 'sch-1',
        attemptId: 'att-1',
        providerPostId: null, // missing providerPostId proof!
        errorCode: null,
      },
    })

    render(
      <R2WorkApprove
        workspaceId={WORKSPACE_ID}
        contentId={CONTENT_ID}
        role="owner"
        snapshot={approvedSnapshot}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '지금 게시 요청' }))

    expect(await screen.findByText(/게시 요청 결과를 명확히 확인하지 못했어요/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '게시 상태 확인 필요' })).toBeDisabled()
  })

  it('이미 승인된 메타 채널이라도 빈칸이 있으면 "지금 게시 요청" 버튼이 비활성화된다', () => {
    const approvedSnapshotWithPlaceholder: ApprovalPreviewSnapshot = {
      ...SNAPSHOT,
      caption: '봄맞이 이벤트 [이벤트 기간]',
      text: '봄맞이 이벤트 [이벤트 기간]',
      approval: { id: 'appr-1', status: 'approved', fingerprint: FINGERPRINT },
    }

    render(
      <R2WorkApprove
        workspaceId={WORKSPACE_ID}
        contentId={CONTENT_ID}
        role="owner"
        snapshot={approvedSnapshotWithPlaceholder}
      />,
    )

    const publishButton = screen.getByRole('button', { name: '지금 게시 요청' })
    expect(publishButton).toBeDisabled()
    expect(screen.getByText('채워지지 않은 빈칸이 있어 실제 게시할 수 없어요. 내용을 먼저 완성해 주세요.')).toBeInTheDocument()
    expect(screen.queryByText('대상 계정과 내용·이미지가 승인되었습니다. 지금 게시 요청 버튼을 눌러 실제 게시를 요청할 수 있어요.')).toBeNull()
    fireEvent.click(publishButton)
    expect(approve).not.toHaveBeenCalled()
  })

  it('snapshot.media 이미지가 제공되면 게시할 이미지 갤러리가 렌더링된다', () => {
    const snapshotWithMedia: ApprovalPreviewSnapshot = {
      ...SNAPSHOT,
      media: [
        {
          id: 'med-1',
          position: 1,
          mimeType: 'image/jpeg',
          altText: '매장 외관 사진',
          src: '/api/workspaces/ws-1/media/med-1',
          width: 800,
          height: 800,
          sizeBytes: 102400,
        },
        {
          id: 'med-2',
          position: 2,
          mimeType: 'image/jpeg',
          altText: '메뉴 사진',
          src: '/api/workspaces/ws-1/media/med-2',
          width: 800,
          height: 800,
          sizeBytes: 102400,
        },
      ],
    }

    render(
      <R2WorkApprove
        workspaceId={WORKSPACE_ID}
        contentId={CONTENT_ID}
        role="owner"
        snapshot={snapshotWithMedia}
      />,
    )

    expect(screen.getByRole('region', { name: '게시할 이미지' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '게시할 이미지 (2장)' })).toBeInTheDocument()
    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(2)
    expect(images[0]).toHaveAttribute('src', '/api/workspaces/ws-1/media/med-1')
    expect(images[0]).toHaveAttribute('alt', '매장 외관 사진')
    expect(images[1]).toHaveAttribute('src', '/api/workspaces/ws-1/media/med-2')
    expect(images[1]).toHaveAttribute('alt', '메뉴 사진')
  })

  it('동일 versionId라도 workspaceId 또는 contentId 또는 fingerprint가 변경되면 승인·게시 상태가 즉시 초기화된다', async () => {
    const { rerender } = render(
      <R2WorkApprove
        workspaceId={WORKSPACE_ID}
        contentId={CONTENT_ID}
        role="owner"
        snapshot={SNAPSHOT}
      />,
    )

    // 승인 실행
    fireEvent.click(screen.getByRole('button', { name: '승인' }))
    expect(await screen.findByRole('button', { name: '지금 게시 요청' })).not.toBeDisabled()

    // 1. workspaceId 변경 (다른 매장)
    rerender(
      <R2WorkApprove
        workspaceId="99999999-9999-4999-8999-999999999999"
        contentId={CONTENT_ID}
        role="owner"
        snapshot={{ ...SNAPSHOT, workspaceId: '99999999-9999-4999-8999-999999999999' }}
      />,
    )
    expect(screen.getByRole('button', { name: '승인' })).not.toBeDisabled()

    // 2. 다시 승인 후 contentId 변경 (다른 콘텐츠)
    fireEvent.click(screen.getByRole('button', { name: '승인' }))
    expect(await screen.findByRole('button', { name: '지금 게시 요청' })).not.toBeDisabled()

    rerender(
      <R2WorkApprove
        workspaceId="99999999-9999-4999-8999-999999999999"
        contentId="88888888-8888-4888-8888-888888888888"
        role="owner"
        snapshot={{ ...SNAPSHOT, workspaceId: '99999999-9999-4999-8999-999999999999', contentId: '88888888-8888-4888-8888-888888888888' }}
      />,
    )
    expect(screen.getByRole('button', { name: '승인' })).not.toBeDisabled()

    // 3. 다시 승인 후 fingerprint 변경 (내용 수정)
    fireEvent.click(screen.getByRole('button', { name: '승인' }))
    expect(await screen.findByRole('button', { name: '지금 게시 요청' })).not.toBeDisabled()

    rerender(
      <R2WorkApprove
        workspaceId="99999999-9999-4999-8999-999999999999"
        contentId="88888888-8888-4888-8888-888888888888"
        role="owner"
        snapshot={{ ...SNAPSHOT, workspaceId: '99999999-9999-4999-8999-999999999999', contentId: '88888888-8888-4888-8888-888888888888', fingerprint: '9'.repeat(64) }}
      />,
    )
    expect(screen.getByRole('button', { name: '승인' })).not.toBeDisabled()
  })

  it('stale async submit 응답 방어: 비동기 응답 도착 전 scopedKey가 달라지면 새 원고에 이전 승인·게시 결과를 오염시키지 않는다', async () => {
    const pending = deferred<{ error: null }>()
    approve.mockReturnValueOnce(pending.promise)

    const { rerender } = render(
      <R2WorkApprove
        workspaceId={WORKSPACE_ID}
        contentId={CONTENT_ID}
        role="owner"
        snapshot={SNAPSHOT}
      />,
    )

    // 1. 원고 A에서 승인 요청 시작 (in-flight)
    fireEvent.click(screen.getByRole('button', { name: '승인' }))
    expect(screen.getByRole('button', { name: '기록하는 중' })).toBeDisabled()

    // 2. 응답 오기 전 다른 원고 B로 전환
    const otherSnapshot: ApprovalPreviewSnapshot = {
      ...SNAPSHOT,
      contentId: '77777777-7777-4777-8777-777777777777',
      fingerprint: '7'.repeat(64),
    }
    rerender(
      <R2WorkApprove
        workspaceId={WORKSPACE_ID}
        contentId="77777777-7777-4777-8777-777777777777"
        role="owner"
        snapshot={otherSnapshot}
      />,
    )

    // 3. 이전 원고 A의 비동기 승인 응답이 뒤늦게 도착
    pending.resolve({ error: null })

    // 4. 원고 A의 비동기 응답은 폐기되고, 원고 B 화면은 오염되지 않아 승인 전 상태인 '승인' 버튼을 유지해야 함
    await waitFor(() => expect(screen.getByRole('button', { name: '승인' })).not.toBeDisabled())
    expect(screen.queryByRole('button', { name: '지금 게시 요청' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '승인 기록됨' })).not.toBeInTheDocument()
  })
})

// @vitest-environment jsdom
/**
 * 수동 활용(COPY/DOWNLOAD) 소비 계약 (ANI-1788 S6, W3 도우미 소비)。
 *
 * 이 파일이 고정하는 것: **복사/다운로드 성공은 게시 검증이 아니다.**
 * - 반환값은 SUCCESS|FAILED 만이고, 게시 URL·검증 지문 같은 'VERIFIED' 신호를 만들지 않는다.
 * - 채널·자산이 확인되지 않으면 성공으로 위장하지 않고 FAILED 로 닫는다.
 */
import { describe, expect, it, vi } from 'vitest'
import { executeManualAction } from './manual-actions'
import type { DraftDto } from './draft-mapper'
import type { ResultActionItem } from './result-screen'

const draft: DraftDto = {
  datasetMode: 'ACTUAL',
  missionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  workspaceId: 'w1',
  copies: {
    instagram: { caption: '10월 오픈 🌿\n예약은  프로필 링크에서  ', cta: '예약하기' },
    threads: { content: '짧은 소식' },
  },
  selectedImageIds: ['img1'],
  mediaPreviews: [{ id: 'img1', url: '/api/workspaces/w1/media/img1' }],
  channels: [{ provider: 'instagram', handle: '@shop' }],
}

const copyItem: ResultActionItem = { action: 'COPY_TEXT', label: '문구 복사', channel: 'instagram' }
const downloadItem: ResultActionItem = { action: 'DOWNLOAD_IMAGE', label: '사진 저장', channel: 'instagram' }

describe('수동 활용 소비 — 복사/다운로드는 게시 검증이 아니다', () => {
  it('복사 성공은 SUCCESS·COPY 이고 게시 검증 신호를 만들지 않는다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const result = await executeManualAction(copyItem, draft, { clipboard: { writeText } })

    expect(result.status).toBe('SUCCESS')
    expect(result.method).toBe('COPY')
    // 게시 검증을 뜻하는 필드가 없어야 한다(승격 금지).
    expect(result).not.toHaveProperty('permalink')
    expect(result).not.toHaveProperty('verified')
    expect(result).not.toHaveProperty('publishedAt')
    // 원문 보존: trim 하지 않는다.
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('예약은  프로필 링크에서  '))
  })

  it('다운로드 성공은 SUCCESS·DOWNLOAD 이고 게시 검증 신호를 만들지 않는다', async () => {
    const triggerDownload = vi.fn()
    const result = await executeManualAction(downloadItem, draft, { triggerDownload })

    expect(result.status).toBe('SUCCESS')
    expect(result.method).toBe('DOWNLOAD')
    expect(result).not.toHaveProperty('permalink')
    expect(result).not.toHaveProperty('verified')
    expect(triggerDownload).toHaveBeenCalledTimes(1)
  })

  it('triggerDownload 미주입 시 document 기반 경로를 쓰되 게시 검증 신호는 만들지 않는다', async () => {
    // jsdom 에는 document 가 있으므로 W3 기본 경로(앵커 다운로드)가 동작하는 것이 정상이다.
    const createElement = vi.spyOn(document, 'createElement')
    const result = await executeManualAction(downloadItem, draft, {})

    expect(result.status).toBe('SUCCESS')
    expect(result.method).toBe('DOWNLOAD')
    expect(createElement).toHaveBeenCalledWith('a')
    expect(result).not.toHaveProperty('permalink')
    expect(result).not.toHaveProperty('verified')
    createElement.mockRestore()
  })

  it('선택한 id 와 미리보기 자산이 어긋나면 첫 프리뷰로 대체하지 않고 FAILED·trigger 0', async () => {
    const triggerDownload = vi.fn()
    const mismatched: DraftDto = { ...draft, selectedImageIds: ['img-missing'] }
    const result = await executeManualAction(downloadItem, mismatched, { triggerDownload })

    expect(result.status).toBe('FAILED')
    expect(triggerDownload).not.toHaveBeenCalled()
  })

  it('원고가 없는 채널은 인스타그램으로 대체하지 않고 FAILED', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const threadsOnly: DraftDto = {
      ...draft,
      copies: { threads: { content: '짧은 소식' } },
    }
    const item: ResultActionItem = { action: 'COPY_TEXT', label: '문구 복사', channel: 'instagram' }
    const result = await executeManualAction(item, threadsOnly, { clipboard: { writeText } })

    expect(result.status).toBe('FAILED')
    expect(writeText).not.toHaveBeenCalled()
  })
})

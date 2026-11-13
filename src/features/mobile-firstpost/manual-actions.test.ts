import { describe, expect, it, vi } from 'vitest'
import { executeManualAction, type ManualActionDependencies } from './manual-actions'
import type { DraftDto } from './draft-mapper'

describe('executeManualAction (ANI-1681 manual copy/download adapter)', () => {
  const sampleDraft: DraftDto = {
    missionId: 'm-123',
    workspaceId: 'ws-456',
    copies: {
      instagram: { caption: '인스타 캡션 내용입니다.', cta: '지금 예약하기' },
      threads: { content: '스레드 본문입니다.', cta: '자세히 보기' },
    },
    selectedImageIds: ['img-1'],
    mediaPreviews: [
      { id: 'img-1', url: 'https://cdn.example.com/photo.jpg', width: 1080, height: 1080 },
    ],
  }

  describe('COPY_TEXT (원고 클립보드 복사)', () => {
    it('지정 채널의 캡션과 CTA를 조합하여 clipboard writeText를 호출하고 성공 결과를 반환한다', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      const deps: ManualActionDependencies = {
        clipboard: { writeText },
      }

      const result = await executeManualAction(
        { action: 'COPY_TEXT', label: '복사', channel: 'instagram' },
        sampleDraft,
        deps,
      )

      expect(result.status).toBe('SUCCESS')
      expect(result.method).toBe('COPY')
      expect(result.message).toContain('클립보드에 복사했어요')
      expect(writeText).toHaveBeenCalledTimes(1)
      expect(writeText).toHaveBeenCalledWith('인스타 캡션 내용입니다.\n\n지금 예약하기')
    })

    it('클립보드 API가 없거나 쓰기 실패 시 성공으로 격상하지 않고 FAILED를 반환한다', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('Permission denied'))
      const deps: ManualActionDependencies = {
        clipboard: { writeText },
      }

      const result = await executeManualAction(
        { action: 'COPY_TEXT', label: '복사', channel: 'instagram' },
        sampleDraft,
        deps,
      )

      expect(result.status).toBe('FAILED')
      expect(result.method).toBe('COPY')
      expect(result.message).toContain('복사하지 못했어요')
    })

    it('원고에 해당 채널 내용이 없으면 실패로 안전하게 닫는다', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      const deps: ManualActionDependencies = { clipboard: { writeText } }
      const emptyDraft: DraftDto = { missionId: 'm-empty' }

      const result = await executeManualAction(
        { action: 'COPY_TEXT', label: '복사', channel: 'instagram' },
        emptyDraft,
        deps,
      )

      expect(result.status).toBe('FAILED')
      expect(result.message).toContain('복사할 원고가 없어요')
      expect(writeText).not.toHaveBeenCalled()
    })

    it('원고 복사 시 사용자 공백/개행을 임의 trim하지 않고 raw 본문 형태를 보존한다', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      const deps: ManualActionDependencies = { clipboard: { writeText } }
      const untrimmedDraft: DraftDto = {
        missionId: 'm-raw',
        copies: {
          instagram: {
            caption: '  앞뒤 공백과\n개행이 있는 원고입니다.  ',
            cta: '  예약 바로가기  ',
          },
        },
      }

      const result = await executeManualAction(
        { action: 'COPY_TEXT', label: '복사', channel: 'instagram' },
        untrimmedDraft,
        deps,
      )

      expect(result.status).toBe('SUCCESS')
      // trim으로 잘려나가지 않고 원형 그대로 보존되어야 함
      expect(writeText).toHaveBeenCalledWith('  앞뒤 공백과\n개행이 있는 원고입니다.  \n\n  예약 바로가기  ')
    })

    it('미지원 채널(unknown channel)인 경우 임의로 instagram으로 fallback하지 않고 실패로 차단한다', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      const deps: ManualActionDependencies = { clipboard: { writeText } }

      const result = await executeManualAction(
        // @ts-expect-error 테스트 목적의 미지원 채널
        { action: 'COPY_TEXT', label: '복사', channel: 'unknown_sns' },
        sampleDraft,
        deps,
      )

      expect(result.status).toBe('FAILED')
      expect(result.message).toContain('지원하지 않는 채널이거나 원고가 없어요')
      expect(writeText).not.toHaveBeenCalled()
    })
  })

  describe('DOWNLOAD_IMAGE (선택 이미지 다운로드)', () => {
    it('선택된 이미지 URL이 유효하면 트리거 함수를 호출하고 성공 결과를 반환한다', async () => {
      const triggerDownload = vi.fn()
      const deps: ManualActionDependencies = { triggerDownload }

      const result = await executeManualAction(
        { action: 'DOWNLOAD_IMAGE', label: '다운로드', channel: 'instagram' },
        sampleDraft,
        deps,
      )

      expect(result.status).toBe('SUCCESS')
      expect(result.method).toBe('DOWNLOAD')
      expect(result.message).toContain('사진 다운로드를 시작했어요')
      expect(triggerDownload).toHaveBeenCalledTimes(1)
      expect(triggerDownload).toHaveBeenCalledWith('https://cdn.example.com/photo.jpg', expect.stringContaining('.jpg'))
    })

    it('다운로드할 이미지 URL이나 스냅샷이 없으면 실패를 반환한다', async () => {
      const triggerDownload = vi.fn()
      const deps: ManualActionDependencies = { triggerDownload }
      const noImageDraft: DraftDto = { missionId: 'm-no-img' }

      const result = await executeManualAction(
        { action: 'DOWNLOAD_IMAGE', label: '다운로드', channel: 'instagram' },
        noImageDraft,
        deps,
      )

      expect(result.status).toBe('FAILED')
      expect(result.message).toContain('다운로드할 사진을 찾지 못했어요')
      expect(triggerDownload).not.toHaveBeenCalled()
    })

    it('선택된 이미지 ID가 프리뷰 목록과 불일치할 때 첫 번째 프리뷰로 fallback하지 않고 trigger 0 및 FAILED 반환', async () => {
      const triggerDownload = vi.fn()
      const deps: ManualActionDependencies = { triggerDownload }
      const mismatchedDraft: DraftDto = {
        missionId: 'm-mismatch',
        selectedImageIds: ['img-not-found'],
        mediaPreviews: [
          { id: 'img-other', url: 'https://cdn.example.com/other-unselected.jpg', width: 500, height: 500 },
        ],
      }

      const result = await executeManualAction(
        { action: 'DOWNLOAD_IMAGE', label: '다운로드', channel: 'instagram' },
        mismatchedDraft,
        deps,
      )

      expect(result.status).toBe('FAILED')
      expect(result.message).toContain('선택된 사진 정보를 찾지 못했어요')
      expect(triggerDownload).not.toHaveBeenCalled()
    })

    it('SSR 환경 등 document가 없는 경우 SUCCESS로 거짓 반환하지 않고 FAILED를 반환한다', async () => {
      // document를 지원하지 않는 환경 흉내 (triggerDownload 주입 없이 default 실행 경로 검증)
      const originalDoc = globalThis.document
      // @ts-expect-error 테스트 환경에서 임시 document undefined 제거
      delete globalThis.document

      try {
        const result = await executeManualAction(
          { action: 'DOWNLOAD_IMAGE', label: '다운로드', channel: 'instagram' },
          sampleDraft,
        )
        expect(result.status).toBe('FAILED')
        expect(result.message).toContain('다운로드를 지원하지 않는 환경이거나')
      } finally {
        globalThis.document = originalDoc
      }
    })

    it('트리거 함수에서 예외 발생 시 FAILED를 반환하며 성공으로 위장하지 않는다', async () => {
      const triggerDownload = vi.fn().mockImplementation(() => {
        throw new Error('Download blocked')
      })
      const deps: ManualActionDependencies = { triggerDownload }

      const result = await executeManualAction(
        { action: 'DOWNLOAD_IMAGE', label: '다운로드', channel: 'instagram' },
        sampleDraft,
        deps,
      )

      expect(result.status).toBe('FAILED')
      expect(result.message).toContain('다운로드하지 못했어요')
    })
  })

  describe('불변식: 수동 복사/다운로드 ≠ 게시 확인 (VERIFIED 격상 금지)', () => {
    it('결과 객체는 manual delivery 기록용 메타데이터만 반환하며 VERIFIED 상태를 임의 생성하지 않는다', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      const deps: ManualActionDependencies = { clipboard: { writeText } }

      const result = await executeManualAction(
        { action: 'COPY_TEXT', label: '복사', channel: 'instagram' },
        sampleDraft,
        deps,
      )

      expect(result).not.toHaveProperty('verified')
      expect(result).not.toHaveProperty('stage', 'OUTCOME_OBSERVED')
      expect(result.method).toBe('COPY')
    })
  })
})

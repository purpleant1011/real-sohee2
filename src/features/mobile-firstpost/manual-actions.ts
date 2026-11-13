import type { DraftDto } from './draft-mapper'
import type { ResultActionItem } from './result-screen'

export interface ClipboardLike {
  writeText: (text: string) => Promise<void>
}

export interface ManualActionDependencies {
  clipboard?: ClipboardLike
  triggerDownload?: (url: string, filename: string) => void
}

export type ManualActionResult = {
  status: 'SUCCESS' | 'FAILED'
  method: 'COPY' | 'DOWNLOAD' | 'UNKNOWN'
  message: string
  copiedText?: string
  downloadedUrl?: string
}

const SUPPORTED_CHANNELS = ['instagram', 'threads'] as const
type SupportedChannel = (typeof SUPPORTED_CHANNELS)[number]

function isSupportedChannel(value: unknown): value is SupportedChannel {
  return typeof value === 'string' && (SUPPORTED_CHANNELS as readonly string[]).includes(value)
}

/**
 * 채널별 원고를 원형 그대로 읽는다.
 * - trim 은 '비어 있는지' 판정에만 쓰고, 클립보드에 넘기는 본문은 사용자가 저장한 그대로 둔다
 *   (앞뒤 공백·개행·CTA 표기를 화면이 임의로 바꾸지 않는다).
 * - 미지원 채널은 instagram 으로 대체하지 않고 null 을 돌려 호출 측이 실패로 닫는다.
 */
function resolveChannelCopy(draft: DraftDto, channel?: unknown): string | null {
  if (!isSupportedChannel(channel)) return null

  const copy = channel === 'threads'
    ? { text: draft.copies?.threads?.content, cta: draft.copies?.threads?.cta }
    : { text: draft.copies?.instagram?.caption, cta: draft.copies?.instagram?.cta }

  const text = typeof copy.text === 'string' ? copy.text : ''
  const cta = typeof copy.cta === 'string' ? copy.cta : ''
  if (text.trim() === '' && cta.trim() === '') return null
  if (text === '' || cta === '') return text || cta
  return `${text}\n\n${cta}`
}

/**
 * 선택된 사진의 URL. 선택 id 가 프리뷰와 맞지 않으면 첫 프리뷰로 대체하지 않는다.
 * 다른 사진을 고객에게 내려받게 하는 것은 선택과 다른 결과다.
 */
function resolveSelectedImageUrl(draft: DraftDto): string | null {
  const selectedId = Array.isArray(draft.selectedImageIds) && typeof draft.selectedImageIds[0] === 'string'
    ? draft.selectedImageIds[0]
    : ''
  if (!selectedId || !Array.isArray(draft.mediaPreviews)) return null

  const found = draft.mediaPreviews.find((m) => m?.id === selectedId)
  const url = typeof found?.url === 'string' ? found.url : ''
  return url.trim() === '' ? null : url
}

/** 다운로드는 브라우저 문서가 있어야 시작할 수 있다. 없는 환경에서 '시작했어요'라고 말하지 않는다. */
function defaultTriggerDownload(url: string, filename: string): void {
  if (typeof document === 'undefined' || !document.body) {
    throw new Error('DOWNLOAD_UNSUPPORTED_ENVIRONMENT')
  }
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

/**
 * 첫 포스팅 결과 화면 수동 전달 액션(복사/다운로드) 실행 어댑터.
 * - 호출 시점의 서버 readback 스냅샷(draft) 원고/사진만 사용한다.
 * - 복사/다운로드 성공은 '직접 전달' 기록일 뿐이며 게시 검증(VERIFIED)으로 승격하지 않는다.
 * - 실패 시 성공으로 위장하지 않고 실패 사유 메시지를 반환한다.
 */
export async function executeManualAction(
  item: ResultActionItem,
  draft: DraftDto,
  deps: ManualActionDependencies = {},
): Promise<ManualActionResult> {
  if (item.action === 'COPY_TEXT') {
    const textToCopy = resolveChannelCopy(draft, item.channel)
    if (!textToCopy) {
      return {
        status: 'FAILED',
        method: 'COPY',
        message: isSupportedChannel(item.channel)
          ? '복사할 원고가 없어요. 초안 상태를 확인해 주세요.'
          : '지원하지 않는 채널이거나 원고가 없어요.',
      }
    }

    const clipboard = deps.clipboard ?? (typeof navigator !== 'undefined' ? navigator.clipboard : undefined)
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      return {
        status: 'FAILED',
        method: 'COPY',
        message: '클립보드를 지원하지 않는 환경이거나 권한이 없어요.',
      }
    }

    try {
      await clipboard.writeText(textToCopy)
      return {
        status: 'SUCCESS',
        method: 'COPY',
        message: '원고를 클립보드에 복사했어요. 채널 앱에 붙여넣어 게시해 주세요.',
        copiedText: textToCopy,
      }
    } catch {
      return {
        status: 'FAILED',
        method: 'COPY',
        message: '원고를 복사하지 못했어요. 브라우저 클립보드 권한을 확인해 주세요.',
      }
    }
  }

  if (item.action === 'DOWNLOAD_IMAGE') {
    const hasSelection = Array.isArray(draft.selectedImageIds) && draft.selectedImageIds.length > 0
    const imageUrl = resolveSelectedImageUrl(draft)
    if (!imageUrl) {
      return {
        status: 'FAILED',
        method: 'DOWNLOAD',
        message: hasSelection
          ? '선택된 사진 정보를 찾지 못했어요. 초안 사진을 다시 확인해 주세요.'
          : '다운로드할 사진을 찾지 못했어요. 초안 사진을 확인해 주세요.',
      }
    }

    const trigger = deps.triggerDownload ?? defaultTriggerDownload
    const filename = `first-post-${isSupportedChannel(item.channel) ? item.channel : 'image'}-${Date.now()}.jpg`

    try {
      trigger(imageUrl, filename)
      return {
        status: 'SUCCESS',
        method: 'DOWNLOAD',
        // 다운로드는 '저장 완료'가 아니라 브라우저가 받기 시작했다는 뜻까지만 말한다.
        message: '사진 다운로드를 시작했어요. 갤러리 또는 다운로드 폴더를 확인해 주세요.',
        downloadedUrl: imageUrl,
      }
    } catch (error) {
      return {
        status: 'FAILED',
        method: 'DOWNLOAD',
        message: error instanceof Error && error.message === 'DOWNLOAD_UNSUPPORTED_ENVIRONMENT'
          ? '다운로드를 지원하지 않는 환경이거나 브라우저에서 막혔어요.'
          : '사진을 다운로드하지 못했어요. 잠시 후 다시 시도해 주세요.',
      }
    }
  }

  return {
    status: 'FAILED',
    method: 'UNKNOWN',
    message: '지원하지 않는 수동 동작이에요.',
  }
}

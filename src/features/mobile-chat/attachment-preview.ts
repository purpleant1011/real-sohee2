/**
 * 채팅 사진 첨부 — 업로드 전 로컬 미리보기 계약.
 *
 * 이 모듈은 네트워크를 쓰지 않는다. 사진을 고르고, 서버 업로드 계약과 같은 기준으로
 * 미리 검사해 거절 사유를 그대로 보여 주는 데까지만 책임진다. 축소·업로드는
 * 업로드 계약(`media-upload.ts`)이 붙는 시점에 다룬다.
 */

import {
  classifyPhotoFile,
  MAX_PHOTO_BYTES,
  type PhotoFileLike,
} from '@/features/mobile-onboarding/photo-intake'

export { MAX_PHOTO_BYTES }

/** 한 번에 붙일 수 있는 사진 수. 서버 계약이 아니라 화면이 스스로 정한 상한이다. */
export const MAX_CHAT_PHOTOS = 3

/** 파일 선택기의 accept 값. `classifyPhotoFile` 이 통과시키는 형식과 같다. */
export const CHAT_PHOTO_ACCEPT = 'image/jpeg,image/png'

/** 아직 보내지 않는다는 사실을 화면에서 숨기지 않는다. */
export const CHAT_PHOTO_LOCAL_ONLY_NOTICE =
  '사진은 이 기기에서만 미리 보여요. 보내는 기능은 아직 연결되지 않았어요.'

export interface ChatPhotoRejection {
  name: string
  message: string
}

export interface ChatPhotoPlan<T extends PhotoFileLike> {
  accepted: T[]
  rejected: ChatPhotoRejection[]
}

/** 같은 사진을 두 번 붙이지 않기 위한 키. 이름과 크기가 같으면 같은 파일로 본다. */
export function photoKey(file: { name: string; size: number }): string {
  return `${file.name}:${file.size}`
}

function limitMessage(max: number): string {
  return `사진은 최대 ${max}장까지 붙일 수 있어요.`
}

const DUPLICATE_MESSAGE = '이미 붙인 사진이에요.'

/**
 * 고른 파일을 붙일지 말지 판정한다.
 *
 * - 이미 붙인 사진(`existingKeys`)과 같은 사진은 중복으로 거절한다.
 * - 상한을 넘는 파일은 검사 전에 거절한다(검사 문구보다 상한이 먼저다).
 * - 나머지는 `classifyPhotoFile` 의 판정과 문구를 그대로 쓴다. 화면이 문구를 새로 짓지 않는다.
 */
export function planChatPhotos<T extends PhotoFileLike>(
  files: readonly T[],
  existingCount = 0,
  max = MAX_CHAT_PHOTOS,
  existingKeys: readonly string[] = [],
): ChatPhotoPlan<T> {
  const accepted: T[] = []
  const rejected: ChatPhotoRejection[] = []
  const seen = new Set(existingKeys)

  let room = Math.max(0, max - Math.max(0, existingCount))

  for (const file of files) {
    const name = typeof file.name === 'string' ? file.name : ''

    if (room <= 0) {
      rejected.push({ name, message: limitMessage(max) })
      continue
    }

    const key = photoKey(file)
    if (seen.has(key)) {
      rejected.push({ name, message: DUPLICATE_MESSAGE })
      continue
    }

    const verdict = classifyPhotoFile(file)
    if (!verdict.ok) {
      rejected.push({ name, message: verdict.message })
      continue
    }

    seen.add(key)
    accepted.push(file)
    room -= 1
  }

  return { accepted, rejected }
}

/** 상한 안내 문구. 화면과 테스트가 같은 문장을 쓴다. */
export function chatPhotoCountLabel(count: number, max = MAX_CHAT_PHOTOS): string {
  return `사진 ${count}장 (최대 ${max}장)`
}

/** 상한에 닿았는지. 닿으면 선택기를 잠근다. */
export function isChatPhotoFull(count: number, max = MAX_CHAT_PHOTOS): boolean {
  return count >= max
}

/** 미리보기 URL. 브라우저가 지원하지 않으면 만들지 않고 null 을 돌려준다(가짜 미리보기 금지). */
export function createPreviewUrl(file: Blob): string | null {
  try {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return null
    }
    return URL.createObjectURL(file)
  } catch {
    return null
  }
}

export function revokePreviewUrl(url: string | null): void {
  if (url === null) return
  try {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url)
    }
  } catch {
    // 해제 실패는 화면 상태를 깨뜨리지 않는다. 브라우저가 페이지를 닫을 때 정리한다.
  }
}

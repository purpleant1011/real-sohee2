export type NaverBlueprintBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'cta'; text: string }
  | { kind: 'image_slot'; position: number; altText?: string }
  | { kind: 'link'; url: string; title: string }
  | { kind: 'map'; placeName: string }

export type NaverImagePlacementInput = {
  mediaId: string
  placement?: string
  altText?: string
}

export type MaterializedNaverEditorBlock =
  | { kind: 'paragraph' | 'heading' | 'quote' | 'cta'; text: string }
  | { kind: 'image'; mediaId: string; altText: string }
  | { kind: 'link'; url: string; title: string }
  | { kind: 'map'; placeName: string }

export function materializeNaverEditorBlocks(
  blueprint: unknown,
  placements: unknown,
): MaterializedNaverEditorBlock[] {
  if (!Array.isArray(blueprint) || !Array.isArray(placements)) {
    throw new Error('네이버 편집 블록 입력을 확인해 주세요.')
  }

  const imageCount = placements.length
  if (blueprint.length < 1 || blueprint.length > 80 || imageCount < 1 || imageCount > 20) {
    throw new Error('네이버 편집 블록 수를 확인해 주세요.')
  }

  let expectedPosition = 1
  const result: MaterializedNaverEditorBlock[] = []

  for (const block of blueprint) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      throw new Error('네이버 편집 블록 형식을 확인해 주세요.')
    }

    const kind = (block as Record<string, unknown>).kind
    if (kind === 'image_slot') {
      const pos = (block as Record<string, unknown>).position
      if (typeof pos !== 'number' || !Number.isInteger(pos)) {
        throw new Error('네이버 이미지 자리 번호를 확인해 주세요.')
      }
      if (pos !== expectedPosition || pos > imageCount) {
        throw new Error('네이버 이미지 자리 순서를 확인해 주세요.')
      }

      const placement = placements[pos - 1]
      if (!placement || typeof placement !== 'object' || Array.isArray(placement)) {
        throw new Error('네이버 이미지 자리 내용을 확인해 주세요.')
      }

      const placementObj = placement as Record<string, unknown>
      const mediaId = placementObj.mediaId
      if (typeof mediaId !== 'string' || mediaId.trim().length === 0) {
        throw new Error('네이버 이미지 자리 내용을 확인해 주세요.')
      }

      const blockAlt = (block as Record<string, unknown>).altText
      const placementAlt = placementObj.altText
      const effectiveAlt =
        typeof blockAlt === 'string' && blockAlt.trim().length > 0
          ? blockAlt.trim()
          : typeof placementAlt === 'string' && placementAlt.trim().length > 0
            ? placementAlt.trim()
            : null

      if (!effectiveAlt) {
        throw new Error('네이버 이미지 자리 내용을 확인해 주세요.')
      }

      result.push({
        kind: 'image',
        mediaId: mediaId.trim(),
        altText: effectiveAlt,
      })
      expectedPosition += 1
    } else if (kind === 'paragraph' || kind === 'heading' || kind === 'quote' || kind === 'cta') {
      const text = (block as Record<string, unknown>).text
      if (typeof text !== 'string' || text.trim().length === 0) {
        throw new Error('네이버 텍스트 블록 내용을 확인해 주세요.')
      }
      result.push({
        kind,
        text,
      })
    } else if (kind === 'link') {
      const url = (block as Record<string, unknown>).url
      const title = (block as Record<string, unknown>).title
      if (
        typeof url !== 'string' ||
        !url.startsWith('https://') ||
        typeof title !== 'string' ||
        title.trim().length === 0
      ) {
        throw new Error('네이버 링크 블록 내용을 확인해 주세요.')
      }
      result.push({
        kind: 'link',
        url,
        title,
      })
    } else if (kind === 'map') {
      const placeName = (block as Record<string, unknown>).placeName
      if (typeof placeName !== 'string' || placeName.trim().length === 0) {
        throw new Error('네이버 지도 장소명 내용을 확인해 주세요.')
      }
      result.push({
        kind: 'map',
        placeName: placeName.trim(),
      })
    } else {
      throw new Error('지원하지 않는 네이버 편집 블록입니다.')
    }
  }

  if (expectedPosition - 1 !== imageCount) {
    throw new Error('네이버 이미지 자리가 승인 이미지 수와 일치하지 않습니다.')
  }

  return result
}

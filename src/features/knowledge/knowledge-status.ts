export type KnowledgeStatus =
  | 'uploading'
  | 'checking'
  | 'review_required'
  | 'approved'
  | 'rejected'
  | 'disabled'

type KnowledgeTransition = Readonly<Record<KnowledgeStatus, readonly KnowledgeStatus[]>>

export const knowledgeTransition: KnowledgeTransition = Object.freeze({
  uploading: Object.freeze(['checking', 'rejected'] as const),
  checking: Object.freeze(['review_required', 'rejected'] as const),
  review_required: Object.freeze(['approved', 'rejected'] as const),
  approved: Object.freeze(['disabled'] as const),
  rejected: Object.freeze([] as const),
  disabled: Object.freeze([] as const),
})

type KnowledgeStatusPresentation = Readonly<{
  label: string
  message: string
}>

const presentations: Record<KnowledgeStatus, KnowledgeStatusPresentation> = {
  uploading: {
    label: '업로드 중',
    message: '자료를 안전하게 전송하고 있어요.',
  },
  checking: {
    label: '확인 중',
    message: '파일 형식과 상태를 확인 중이에요. 악성 파일 검사 완료를 의미하지 않아요.',
  },
  review_required: {
    label: '검토 필요',
    message: '콘텐츠 근거로 쓰기 전에 사람의 검토가 필요해요.',
  },
  approved: {
    label: '승인됨',
    message: '승인된 범위에서 콘텐츠 근거로 사용할 수 있어요.',
  },
  rejected: {
    label: '반려됨',
    message: '콘텐츠 근거로 사용하지 않아요.',
  },
  disabled: {
    label: '사용 중지',
    message: '이 자료는 더 이상 콘텐츠 근거로 사용하지 않아요.',
  },
}

const unknownPresentation: KnowledgeStatusPresentation = {
  label: '상태 확인 필요',
  message: '자료 상태를 확인해 주세요.',
}

function isKnowledgeStatus(value: unknown): value is KnowledgeStatus {
  switch (value) {
    case 'uploading':
    case 'checking':
    case 'review_required':
    case 'approved':
    case 'rejected':
    case 'disabled':
      return true
    default:
      return false
  }
}

export function canTransitionKnowledgeStatus(from: unknown, to: unknown): boolean {
  if (!isKnowledgeStatus(from) || !isKnowledgeStatus(to)) {
    return false
  }

  const allowedStatuses = knowledgeTransition[from]
  const allowedStatusCount = allowedStatuses.length

  for (let index = 0; index < allowedStatusCount; index += 1) {
    if (allowedStatuses[index] === to) {
      return true
    }
  }

  return false
}

export function canUseAsEvidence(input: unknown): boolean {
  if (input === null || typeof input !== 'object') {
    return false
  }

  try {
    if (Array.isArray(input)) {
      return false
    }

    const status = (input as Record<string, unknown>).status
    return status === 'approved'
  } catch {
    return false
  }
}

export function getKnowledgeStatusPresentation(status: unknown): KnowledgeStatusPresentation {
  const presentation = isKnowledgeStatus(status)
    ? presentations[status]
    : unknownPresentation

  return Object.freeze({
    label: presentation.label,
    message: presentation.message,
  })
}

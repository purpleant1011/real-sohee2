export type WorkspaceRole = 'owner' | 'manager' | 'reviewer' | 'viewer'

export type ApprovalMediaItem = {
  readonly id: string
  readonly isValid: boolean
}

export type ApprovalCandidate = {
  readonly isLatestVersion: boolean
  readonly role: WorkspaceRole
  readonly rightsConfirmed: boolean
  readonly generationEvidenceConfirmed: boolean
  readonly disclosureRequired: boolean
  readonly disclosure: string
  readonly media: readonly ApprovalMediaItem[]
}

export type ApprovalRequirementKey =
  | 'latestVersion'
  | 'approvalPermission'
  | 'rights'
  | 'evidence'
  | 'disclosure'
  | 'media'

export type ApprovalRequirement = {
  key: ApprovalRequirementKey
  met: boolean
  message: string
}

const MAX_ARRAY_LENGTH = 2 ** 32 - 1
const MAX_ARRAY_INDEX = MAX_ARRAY_LENGTH - 1

const messages: Record<
  ApprovalRequirementKey,
  { readonly met: string; readonly unmet: string }
> = {
  latestVersion: {
    met: '최신 버전입니다.',
    unmet: '최신 버전을 다시 확인해 주세요.',
  },
  approvalPermission: {
    met: '콘텐츠를 승인할 권한이 있습니다.',
    unmet: '콘텐츠 승인 권한을 확인해 주세요.',
  },
  rights: {
    met: '콘텐츠 사용권을 확인했습니다.',
    unmet: '콘텐츠 사용권을 확인해 주세요.',
  },
  evidence: {
    met: '자동 생성 증빙을 확인했습니다.',
    unmet: '자동 생성 증빙을 확인해 주세요.',
  },
  disclosure: {
    met: '필수 고지 조건을 충족했습니다.',
    unmet: '필수 고지 내용을 입력해 주세요.',
  },
  media: {
    met: '모든 미디어가 유효합니다.',
    unmet: '미디어를 하나 이상 추가하고 모두 유효한지 확인해 주세요.',
  },
}

function safePredicate(predicate: () => boolean): boolean {
  try {
    return predicate() === true
  } catch {
    return false
  }
}

function requirement(key: ApprovalRequirementKey, met: boolean): ApprovalRequirement {
  return {
    key,
    met,
    message: met ? messages[key].met : messages[key].unmet,
  }
}

function isCanonicalArrayIndex(key: PropertyKey): boolean {
  if (typeof key !== 'string') return false

  const index = Number(key)
  return (
    Number.isInteger(index) && index >= 0 && index <= MAX_ARRAY_INDEX && String(index) === key
  )
}

export function evaluateApprovalRequirements(input: ApprovalCandidate): ApprovalRequirement[] {
  const latestVersion = safePredicate(() => {
    const isLatestVersion = input.isLatestVersion
    return isLatestVersion === true
  })
  const approvalPermission = safePredicate(() => {
    const role = input.role
    return role === 'owner' || role === 'manager' || role === 'reviewer'
  })
  const rights = safePredicate(() => {
    const rightsConfirmed = input.rightsConfirmed
    return rightsConfirmed === true
  })
  const evidence = safePredicate(() => {
    const generationEvidenceConfirmed = input.generationEvidenceConfirmed
    return generationEvidenceConfirmed === true
  })
  const disclosure = safePredicate(() => {
    const disclosureRequired = input.disclosureRequired
    const disclosureText = input.disclosure

    if (typeof disclosureRequired !== 'boolean' || typeof disclosureText !== 'string') {
      return false
    }

    return !disclosureRequired || disclosureText.trim().length > 0
  })
  const media = safePredicate(() => {
    const mediaItems = input.media
    if (!Array.isArray(mediaItems)) return false

    const mediaCount = mediaItems.length
    if (
      !Number.isSafeInteger(mediaCount) ||
      mediaCount <= 0 ||
      mediaCount > MAX_ARRAY_LENGTH
    ) {
      return false
    }

    const ownKeys = Reflect.ownKeys(mediaItems)
    const ownIndexKeys = new Set(ownKeys.filter(isCanonicalArrayIndex))
    if (ownIndexKeys.size !== mediaCount) return false

    for (let index = 0; index < mediaCount; index += 1) {
      if (!ownIndexKeys.has(String(index))) return false
      if (!Object.hasOwn(mediaItems, index)) return false

      const item = mediaItems[index]
      if (typeof item !== 'object' || item === null) return false

      const id = item.id
      const isValid = item.isValid
      if (typeof id !== 'string' || id.trim().length === 0 || isValid !== true) return false
    }

    return true
  })

  return [
    requirement('latestVersion', latestVersion),
    requirement('approvalPermission', approvalPermission),
    requirement('rights', rights),
    requirement('evidence', evidence),
    requirement('disclosure', disclosure),
    requirement('media', media),
  ]
}

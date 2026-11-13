import { sanitizeNotificationBody } from '@/features/notifications/safe-notification-body'

const GENERAL_REPLACEMENT = '관련 작업의 처리 상태를 확인해 주세요.'
const PUBLISH_REPLACEMENT = '게시 처리 상태를 확인해 주세요.'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const regexpTest = RegExp.prototype.test
const reflectApply = Reflect.apply
const objectFreeze = Object.freeze
const invalidInput = Symbol('invalidWorkspaceSearchInput')

export type SearchKind =
  | 'menu'
  | 'content'
  | 'schedule'
  | 'notification'
  | 'knowledge'
  | 'automation'

export type SearchRequest = Readonly<{
  workspaceId: string
  query: string
  cursor?: string
}>

export type WorkspaceSearchResult = Readonly<{
  workspaceId: string
  kind: SearchKind
  resourceId: string
  title: string
  statusLabel: string
  href: string
}>

type SearchRequestSnapshot = {
  workspaceId: string
  query: string
  hasCursor: boolean
  cursor?: string
}

type ResultKeySnapshot = {
  input: object
  workspaceId: unknown
}

type ResultValueSnapshot = {
  kind: SearchKind
  resourceId: string
  title: string
  statusLabel: string
  href: string
}

function isUuid(value: unknown): value is string {
  if (typeof value !== 'string') return false

  try {
    return reflectApply(regexpTest, UUID_PATTERN, [value]) as boolean
  } catch {
    return false
  }
}

function snapshotRequest(input: unknown): SearchRequestSnapshot | typeof invalidInput {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return invalidInput
    }

    const keys = Reflect.ownKeys(input)
    let hasWorkspaceId = false
    let hasQuery = false
    let hasCursor = false

    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]

      if (key === 'workspaceId') hasWorkspaceId = true
      else if (key === 'query') hasQuery = true
      else if (key === 'cursor') hasCursor = true
      else return invalidInput
    }

    if (!hasWorkspaceId || !hasQuery) return invalidInput

    const workspaceId = Reflect.get(input, 'workspaceId')
    if (!isUuid(workspaceId)) return invalidInput

    const query = safeSearchQuery(Reflect.get(input, 'query'))
    if (query === null) return invalidInput

    const snapshot = Object.create(null) as SearchRequestSnapshot
    snapshot.workspaceId = workspaceId
    snapshot.query = query
    snapshot.hasCursor = hasCursor

    if (hasCursor) {
      const cursor = Reflect.get(input, 'cursor')
      if (!isUuid(cursor)) return invalidInput
      snapshot.cursor = cursor
    }

    return snapshot
  } catch {
    return invalidInput
  }
}

function safeSearchQuery(input: unknown): string | null {
  if (typeof input !== 'string') return null

  const sanitized = sanitizeNotificationBody(input)

  if (
    sanitized === GENERAL_REPLACEMENT ||
    sanitized === PUBLISH_REPLACEMENT ||
    sanitized.length < 2 ||
    sanitized.length > 80
  ) {
    return null
  }

  return sanitized
}

export function normalizeSearchRequest(input: unknown): SearchRequest | null {
  const snapshot = snapshotRequest(input)

  if (snapshot === invalidInput) return null

  if (!snapshot.hasCursor) {
    return objectFreeze({ workspaceId: snapshot.workspaceId, query: snapshot.query })
  }

  return objectFreeze({
    workspaceId: snapshot.workspaceId,
    query: snapshot.query,
    cursor: snapshot.cursor as string,
  })
}

function snapshotResultKeys(input: unknown): ResultKeySnapshot | typeof invalidInput {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return invalidInput
    }

    const keys = Reflect.ownKeys(input)
    let hasWorkspaceId = false
    let hasKind = false
    let hasResourceId = false
    let hasTitle = false
    let hasStatus = false

    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]

      if (key === 'workspaceId') hasWorkspaceId = true
      else if (key === 'kind') hasKind = true
      else if (key === 'resourceId') hasResourceId = true
      else if (key === 'title') hasTitle = true
      else if (key === 'status') hasStatus = true
      else return invalidInput
    }

    if (!hasWorkspaceId || !hasKind || !hasResourceId || !hasTitle || !hasStatus) {
      return invalidInput
    }

    return {
      input,
      workspaceId: Reflect.get(input, 'workspaceId'),
    }
  } catch {
    return invalidInput
  }
}

function snapshotResultValues(input: object): ResultValueSnapshot | typeof invalidInput {
  try {
    const kind = Reflect.get(input, 'kind')
    if (!isSearchKind(kind)) return invalidInput

    const resourceId = Reflect.get(input, 'resourceId')
    if (typeof resourceId !== 'string') return invalidInput

    const href = resultHref(kind, resourceId)
    if (href === null) return invalidInput

    const title = safeTitle(Reflect.get(input, 'title'))
    if (title === null) return invalidInput

    const status = Reflect.get(input, 'status')
    if (typeof status !== 'string') return invalidInput

    const snapshot = Object.create(null) as ResultValueSnapshot
    snapshot.kind = kind
    snapshot.resourceId = resourceId
    snapshot.title = title
    snapshot.statusLabel = statusLabel(kind, status)
    snapshot.href = href
    return snapshot
  } catch {
    return invalidInput
  }
}

function isSearchKind(value: unknown): value is SearchKind {
  return (
    value === 'menu' ||
    value === 'content' ||
    value === 'schedule' ||
    value === 'notification' ||
    value === 'knowledge' ||
    value === 'automation'
  )
}

function safeTitle(input: unknown): string | null {
  if (typeof input !== 'string') return null

  const sanitized = sanitizeNotificationBody(input)

  if (
    sanitized.length === 0 ||
    sanitized.length > 120 ||
    sanitized === GENERAL_REPLACEMENT ||
    sanitized === PUBLISH_REPLACEMENT
  ) {
    return '관련 항목'
  }

  return sanitized
}

function statusLabel(kind: SearchKind, status: string): string {
  switch (kind) {
    case 'menu':
      return status === 'available' ? '바로가기' : '상태 확인 필요'
    case 'content':
      switch (status) {
        case 'draft':
          return '초안 준비'
        case 'in_review':
          return '승인 대기'
        case 'approved':
          return '승인 완료'
        case 'scheduled':
          return '게시 준비'
        case 'published':
          return '게시 완료'
        default:
          return '상태 확인 필요'
      }
    case 'schedule':
      switch (status) {
        case 'scheduled':
          return '예약됨'
        case 'published':
          return '게시 완료'
        case 'temporary_failure':
          return '일시 실패'
        case 'token_expired':
          return '권한 만료'
        case 'reapproval_required':
          return '재승인 필요'
        case 'provider_rejected':
          return '영구 실패'
        default:
          return '상태 확인 필요'
      }
    case 'notification':
      if (status === 'unread') return '읽지 않음'
      if (status === 'read') return '읽음'
      return '상태 확인 필요'
    case 'knowledge':
      switch (status) {
        case 'uploading':
          return '업로드 중'
        case 'checking':
          return '확인 중'
        case 'review_required':
          return '검토 필요'
        case 'approved':
          return '승인'
        case 'rejected':
          return '거절'
        case 'disabled':
          return '사용 중지'
        default:
          return '상태 확인 필요'
      }
    case 'automation':
      switch (status) {
        case 'inactive':
          return '비활성'
        case 'active':
          return '활성'
        case 'running':
          return '실행 중'
        case 'succeeded':
          return '성공'
        case 'failed':
          return '실패'
        default:
          return '상태 확인 필요'
      }
  }
}

function menuHref(resourceId: string): string | null {
  switch (resourceId) {
    case 'home':
      return '/app'
    case 'work':
      return '/app/work'
    case 'schedule':
      return '/app/schedule'
    case 'reports':
      return '/app/reports'
    case 'account':
      return '/app/account'
    case 'notifications':
      return '/app/notifications'
    default:
      return null
  }
}

function resultHref(kind: SearchKind, resourceId: string): string | null {
  switch (kind) {
    case 'menu':
      return menuHref(resourceId)
    case 'content':
      return isUuid(resourceId) ? `/app/work/${resourceId}` : null
    case 'schedule':
      return isUuid(resourceId) ? `/app/schedule?item=${resourceId}` : null
    case 'notification':
      return isUuid(resourceId) ? `/app/notifications?item=${resourceId}` : null
    case 'knowledge':
      return isUuid(resourceId) ? `/app/account/knowledge?item=${resourceId}` : null
    case 'automation':
      return isUuid(resourceId) ? `/app/account/automation?item=${resourceId}` : null
  }
}

export function toWorkspaceSearchResult(
  expectedWorkspaceId: unknown,
  input: unknown,
): WorkspaceSearchResult | null {
  if (!isUuid(expectedWorkspaceId)) return null

  const keys = snapshotResultKeys(input)
  if (
    keys === invalidInput ||
    !isUuid(keys.workspaceId) ||
    keys.workspaceId !== expectedWorkspaceId
  ) {
    return null
  }

  const values = snapshotResultValues(keys.input)
  if (values === invalidInput) return null

  return objectFreeze({
    workspaceId: keys.workspaceId,
    kind: values.kind,
    resourceId: values.resourceId,
    title: values.title,
    statusLabel: values.statusLabel,
    href: values.href,
  })
}

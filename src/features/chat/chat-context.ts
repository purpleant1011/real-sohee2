import { sanitizeNotificationBody } from '@/features/notifications/safe-notification-body'
import type { ChatContext, ChatResourceKind, ChatSelectedResource } from './types'

const GENERAL_REPLACEMENT = '관련 작업의 처리 상태를 확인해 주세요.'
const PUBLISH_REPLACEMENT = '게시 처리 상태를 확인해 주세요.'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const APPROVED_STATUS_LABELS = Object.freeze([
  '상태 확인 필요',
  '초안 준비',
  '승인 대기',
  '승인 완료',
  '게시 준비',
  '게시 완료',
  '게시 복구',
  '예약됨',
  '일시 실패',
  '권한 만료',
  '재승인 필요',
  '영구 실패',
  '읽지 않음',
  '읽음',
  '확인 필요',
  '업로드 중',
  '확인 중',
  '검토 필요',
  '승인',
  '거절',
  '사용 중지',
  '비활성',
  '활성',
  '실행 중',
  '성공',
  '실패',
] as const)

type ResourceSnapshot = {
  kind: unknown
  id: unknown
  title: unknown
  statusLabel: unknown
  hasSummary: boolean
  summary?: unknown
}

const invalidResource = Symbol('invalidChatSelectedResource')

function isChatResourceKind(value: unknown): value is ChatResourceKind {
  return (
    value === 'content' ||
    value === 'schedule' ||
    value === 'notification' ||
    value === 'knowledge' ||
    value === 'automation'
  )
}

function safeRoute(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > 256) {
    return '/app'
  }

  try {
    if (
      !/^\/app(?:\/[a-z0-9_-]+)*$/iu.test(input) ||
      sanitizeNotificationBody(input) !== input
    ) {
      return '/app'
    }

    return input
  } catch {
    return '/app'
  }
}

function snapshotResource(input: unknown): ResourceSnapshot | typeof invalidResource {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return invalidResource
    }

    const keys = Reflect.ownKeys(input)
    let hasKind = false
    let hasId = false
    let hasTitle = false
    let hasStatusLabel = false
    let hasSummary = false

    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]

      if (key === 'kind') hasKind = true
      else if (key === 'id') hasId = true
      else if (key === 'title') hasTitle = true
      else if (key === 'statusLabel') hasStatusLabel = true
      else if (key === 'summary') hasSummary = true
      else return invalidResource
    }

    if (!hasKind || !hasId || !hasTitle || !hasStatusLabel) {
      return invalidResource
    }

    const snapshot = Object.create(null) as ResourceSnapshot
    snapshot.kind = Reflect.get(input, 'kind')
    snapshot.id = Reflect.get(input, 'id')
    snapshot.title = Reflect.get(input, 'title')
    snapshot.statusLabel = Reflect.get(input, 'statusLabel')
    snapshot.hasSummary = hasSummary

    if (hasSummary) snapshot.summary = Reflect.get(input, 'summary')

    return snapshot
  } catch {
    return invalidResource
  }
}

function safeText(input: unknown, fallback: string, maxLength: number): string | null {
  if (typeof input !== 'string') return null

  const sanitized = sanitizeNotificationBody(input)

  if (
    sanitized.length === 0 ||
    sanitized.length > maxLength ||
    sanitized === GENERAL_REPLACEMENT ||
    sanitized === PUBLISH_REPLACEMENT
  ) {
    return fallback
  }

  return sanitized
}

function approvedStatusLabel(value: string): string {
  for (let index = 0; index < APPROVED_STATUS_LABELS.length; index += 1) {
    if (APPROVED_STATUS_LABELS[index] === value) return value
  }

  return '상태 확인 필요'
}

function selectedResource(input: unknown): ChatSelectedResource | null {
  const snapshot = snapshotResource(input)

  if (
    snapshot === invalidResource ||
    !isChatResourceKind(snapshot.kind) ||
    typeof snapshot.id !== 'string' ||
    !UUID_PATTERN.test(snapshot.id)
  ) {
    return null
  }

  const title = safeText(snapshot.title, '선택한 자료', 100)
  const safeStatusLabel = safeText(snapshot.statusLabel, '상태 확인 필요', 60)

  if (title === null || safeStatusLabel === null) return null

  const statusLabel = approvedStatusLabel(safeStatusLabel)

  if (!snapshot.hasSummary) {
    return Object.freeze({
      kind: snapshot.kind,
      id: snapshot.id,
      title,
      statusLabel,
    })
  }

  const summary = safeText(
    snapshot.summary,
    '선택한 자료의 세부 내용은 관련 화면에서 확인해 주세요.',
    200,
  )

  if (summary === null) return null

  return Object.freeze({
    kind: snapshot.kind,
    id: snapshot.id,
    title,
    statusLabel,
    summary,
  })
}

export function buildChatContext(route: unknown, resource: unknown): ChatContext {
  return Object.freeze({
    route: safeRoute(route),
    selectedResource: selectedResource(resource),
  })
}

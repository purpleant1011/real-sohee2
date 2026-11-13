import { z } from 'zod'

export type AutomationRuleKind =
  | 'faq_safe_reply'
  | 'schedule_reminder'
  | 'content_draft'

export type AutomationRole = 'owner' | 'manager' | 'reviewer' | 'viewer'

type RuleSnapshot = {
  hasKind: boolean
  hasActive: boolean
  hasApprovalRequired: boolean
  kind?: unknown
  active?: unknown
  approvalRequired?: unknown
}

type NormalizedRule = {
  kind: AutomationRuleKind
  active: boolean
  approvalRequired: boolean
}

const invalidRuleInput = Symbol('invalidAutomationRuleInput')

function snapshotRuleInput(input: unknown): RuleSnapshot | typeof invalidRuleInput {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return invalidRuleInput
    }

    const ownKeys = Reflect.ownKeys(input)
    let hasKind = false
    let hasActive = false
    let hasApprovalRequired = false

    for (let index = 0; index < ownKeys.length; index += 1) {
      const key = ownKeys[index]
      if (key === 'kind') hasKind = true
      else if (key === 'active') hasActive = true
      else if (key === 'approvalRequired') hasApprovalRequired = true
      else return invalidRuleInput
    }

    const snapshot = Object.create(null) as RuleSnapshot
    snapshot.hasKind = hasKind
    snapshot.hasActive = hasActive
    snapshot.hasApprovalRequired = hasApprovalRequired

    if (hasKind) snapshot.kind = Reflect.get(input, 'kind')
    if (hasActive) snapshot.active = Reflect.get(input, 'active')
    if (hasApprovalRequired) {
      snapshot.approvalRequired = Reflect.get(input, 'approvalRequired')
    }

    return snapshot
  } catch {
    return invalidRuleInput
  }
}

function isAutomationRuleKind(value: unknown): value is AutomationRuleKind {
  return (
    value === 'faq_safe_reply' ||
    value === 'schedule_reminder' ||
    value === 'content_draft'
  )
}

export const ruleSchema = z.unknown().transform((input, context): NormalizedRule => {
  const snapshot = snapshotRuleInput(input)

  if (snapshot === invalidRuleInput) {
    context.addIssue({
      code: 'custom',
      message: '자동화 규칙 입력을 확인해 주세요.',
    })
    return z.NEVER
  }

  const kind = snapshot.kind
  if (!snapshot.hasKind || !isAutomationRuleKind(kind)) {
    context.addIssue({
      code: 'custom',
      path: ['kind'],
      message: '자동화 규칙 종류를 확인해 주세요.',
    })
    return z.NEVER
  }

  const active = snapshot.hasActive ? snapshot.active : false
  if (typeof active !== 'boolean') {
    context.addIssue({
      code: 'custom',
      path: ['active'],
      message: '활성 상태는 참 또는 거짓이어야 합니다.',
    })
    return z.NEVER
  }

  const approvalRequired = snapshot.approvalRequired
  if (!snapshot.hasApprovalRequired || typeof approvalRequired !== 'boolean') {
    context.addIssue({
      code: 'custom',
      path: ['approvalRequired'],
      message: '승인 설정은 참 또는 거짓이어야 합니다.',
    })
    return z.NEVER
  }

  if (kind === 'content_draft' && approvalRequired !== true) {
    context.addIssue({
      code: 'custom',
      path: ['approvalRequired'],
      message: '콘텐츠 초안은 사람의 승인이 필요합니다.',
    })
    return z.NEVER
  }

  return { kind, active, approvalRequired }
})

export type AutomationRuleInput = z.infer<typeof ruleSchema>

export function canEditAutomation(role: unknown): boolean {
  return role === 'owner' || role === 'manager'
}

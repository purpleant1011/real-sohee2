/**
 * SOHEE V0.91 · M4 Content Revision & Dock Mode Pure Runtime (HF-23, HF-25)
 * 
 * Pure functions & types safe for both Client and Edge Server components.
 */

export type DockUIMode = 'EDUCATION' | 'WORK' | 'ATTENTION'
export type RuntimeReadinessState = 'SOHEE_READY' | 'READY_DEGRADED' | 'BLOCKED'

export interface ContentItem {
  id: string
  workspaceId: string
  version: number
  caption: string
  imageUrl?: string
  channels: ('instagram' | 'threads')[]
  fingerprint: string
  harnessVersionSnapshot: {
    textVersion?: string
    imageVersion?: string
  }
}

export interface ContentApprovalRecord {
  id: string
  contentId: string
  contentVersion: number
  fingerprint: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'INVALIDATED' | 'SUPERSEDED'
  approvedAt?: string
  invalidationReason?: string
}

/**
 * HF-23: Persistent Sohee Dock Mode Resolver
 * Maps runtime conditions to EDUCATION | WORK | ATTENTION
 */
export function resolveDockUIMode(params: {
  isSoheeReady: boolean
  hasPendingApproval: boolean
  runtimeReadiness: RuntimeReadinessState
}): DockUIMode {
  const { isSoheeReady, hasPendingApproval, runtimeReadiness } = params

  if (!isSoheeReady || runtimeReadiness === 'BLOCKED') {
    return 'EDUCATION'
  }

  if (hasPendingApproval || runtimeReadiness === 'READY_DEGRADED') {
    return 'ATTENTION'
  }

  return 'WORK'
}

/**
 * HF-25: Natural-Language Revision & Approval Invalidation
 * Increments version, updates fingerprint, and immediately invalidates existing approval.
 */
export function reviseContentWithNaturalLanguage(params: {
  content: ContentItem
  existingApproval?: ContentApprovalRecord
  revisionPrompt: string
}): {
  newContent: ContentItem
  invalidatedApproval: ContentApprovalRecord
} {
  const { content, existingApproval, revisionPrompt } = params
  const newVersion = content.version + 1
  const newFingerprint = `fp-v${newVersion}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`

  // Construct revised caption
  const revisedCaption = `${content.caption}\n\n[수정 반영: ${revisionPrompt}]`

  const newContent: ContentItem = {
    ...content,
    version: newVersion,
    caption: revisedCaption,
    fingerprint: newFingerprint,
  }

  const invalidatedApproval: ContentApprovalRecord = existingApproval
    ? {
        ...existingApproval,
        status: 'INVALIDATED',
        invalidationReason: `NATURAL_LANGUAGE_REVISION: 콘텐츠 V${newVersion} 수정으로 인해 기존 승인이 무효화되었습니다.`,
      }
    : {
        id: `appr_inv_${Date.now()}`,
        contentId: content.id,
        contentVersion: content.version,
        fingerprint: content.fingerprint,
        status: 'INVALIDATED',
        invalidationReason: `NATURAL_LANGUAGE_REVISION: 콘텐츠 V${newVersion} 수정으로 인해 기존 승인이 무효화되었습니다.`,
      }

  return {
    newContent,
    invalidatedApproval,
  }
}

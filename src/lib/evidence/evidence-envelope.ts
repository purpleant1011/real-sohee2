/**
 * Canonical EvidenceEnvelope & Production Release Gate (ANI-1052, ANI-1056)
 *
 * Enforces the strict epistemic evidence contract required for 9th revision First Marketing Outcome:
 * - Every production claim requires an intact cryptographic & database lineage
 * - No P0 issue can be considered Done without a verified EvidenceEnvelope
 */

export interface EvidenceEnvelope {
  testRunId: string
  runMarker: string
  environment: 'production' | 'staging' | 'preview' | 'test'
  url: string
  workspaceId: string
  actorUserId: string
  gitSha: string
  migrationHead: string
  providerAccountId: string
  channel: 'instagram' | 'threads'
  contentId: string
  contentVersionId: string
  contentFingerprint: string
  approvalId: string
  actionRequestId: string
  actionAttemptId: string
  externalPostId: string
  externalPermalink: string
  receiptId: string
  observedAt: string
  sameTruthVerified: boolean
}

export interface EvidenceValidationResult {
  valid: boolean
  missingFields: readonly string[]
  reason?: string
}

export const REQUIRED_ENVELOPE_FIELDS: readonly (keyof EvidenceEnvelope)[] = [
  'testRunId',
  'runMarker',
  'environment',
  'url',
  'workspaceId',
  'actorUserId',
  'gitSha',
  'migrationHead',
  'providerAccountId',
  'channel',
  'contentId',
  'contentVersionId',
  'contentFingerprint',
  'approvalId',
  'actionRequestId',
  'actionAttemptId',
  'externalPostId',
  'externalPermalink',
  'receiptId',
  'observedAt',
  'sameTruthVerified',
]

export function validateEvidenceEnvelope(
  envelope: Partial<EvidenceEnvelope>,
): EvidenceValidationResult {
  const missingFields: string[] = []

  for (const field of REQUIRED_ENVELOPE_FIELDS) {
    const val = envelope[field]
    if (val === undefined || val === null || val === '') {
      missingFields.push(field)
    }
  }

  if (missingFields.length > 0) {
    return {
      valid: false,
      missingFields,
      reason: `EvidenceEnvelope 필수 증거 필드가 누락되었습니다: ${missingFields.join(', ')}`,
    }
  }

  if (envelope.sameTruthVerified !== true) {
    return {
      valid: false,
      missingFields: ['sameTruthVerified'],
      reason: 'Same Truth(DB 영수증과 Provider Readback 결과의 일치) 검증이 완료되지 않았습니다.',
    }
  }

  return {
    valid: true,
    missingFields: [],
  }
}

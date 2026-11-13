import { z } from 'zod'

import { channelContentSchema } from '@/features/content/channel-content-schema'

const uuid = z.string().uuid()
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/)
const httpsUrl = z.string().url().max(2_048).refine((value) => new URL(value).protocol === 'https:', {
  message: 'HTTPS 주소만 사용할 수 있습니다.',
})

export const localPublishPhaseSchema = z.enum([
  'claimed',
  'account_verified',
  'editor_ready',
  'content_filled',
  'preflight_verified',
  'submitted',
  'result_observed',
  'succeeded',
  'device_offline',
  'reauth_required',
  'target_mismatch',
  'ui_drift',
  'media_download_failed',
  'media_upload_failed',
  'content_mismatch',
  'deadline_expired',
  'policy_restriction',
  'failed_before_submit',
  'unknown_after_submit',
  'reconfirmation_required',
  'cancelled',
])

export const failureCodeSchema = z.enum([
  'REAUTH_REQUIRED',
  'CATEGORY_NOT_FOUND',
  'DRAFT_RECOVERY_PENDING',
  'UI_DRIFT',
  'TARGET_MISMATCH',
  'POLICY_RESTRICTION',
  'CONTENT_MISMATCH',
  'MEDIA_DOWNLOAD_FAILED',
  'MEDIA_UPLOAD_FAILED',
  'DEADLINE_EXPIRED',
  'DEVICE_OFFLINE',
  'SUBMIT_PERMIT_REQUIRED',
  'UNKNOWN_RESULT',
])

const mediaSchema = z.object({
  id: uuid,
  position: z.number().int().min(0).max(19),
  signedUrl: httpsUrl,
  digest: fingerprint,
}).strict()

export const localPublishJobSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  channel: z.enum(['naver_blog', 'daangn_business']),
  actionKind: z.enum(['blog_post', 'business_news_post']),
  targetConnectionId: uuid,
  environment: z.enum(['test', 'production']).optional(),
  targetExternalId: z.string().min(1).max(255),
  targetLabel: z.string().min(1).max(255),
  contentVersionId: uuid,
  versionFingerprint: fingerprint,
  approvalId: uuid,
  approvalFingerprint: fingerprint,
  structuredPayload: channelContentSchema,
  media: z.array(mediaSchema).min(1).max(20),
  submitPermitRequired: z.literal(true),
}).strict().superRefine((value, context) => {
  if (value.versionFingerprint !== value.approvalFingerprint) {
    context.addIssue({
      code: 'custom',
      path: ['approvalFingerprint'],
      message: '승인 fingerprint와 콘텐츠 버전 fingerprint가 일치해야 합니다.',
    })
  }
  if (value.structuredPayload.channel !== value.channel) {
    context.addIssue({
      code: 'custom',
      path: ['structuredPayload', 'channel'],
      message: '구조화 콘텐츠와 게시 채널이 일치해야 합니다.',
    })
  }
  if (value.channel !== 'naver_blog' && value.media.length > 10) {
    context.addIssue({
      code: 'custom',
      path: ['media'],
      message: '네이버 블로그 외 채널은 미디어를 최대 10개까지 사용할 수 있습니다.',
    })
  }
  const expectedAction = value.channel === 'naver_blog' ? 'blog_post' : 'business_news_post'
  if (value.actionKind !== expectedAction) {
    context.addIssue({
      code: 'custom',
      path: ['actionKind'],
      message: '게시 채널과 작업 종류가 일치해야 합니다.',
    })
  }
  value.media.forEach((item, index) => {
    if (item.position !== index) {
      context.addIssue({
        code: 'custom',
        path: ['media', index, 'position'],
        message: '미디어 순서는 0부터 연속이어야 합니다.',
      })
    }
  })
})

const terminalFailurePhases = new Set([
  'failed_before_submit',
  'unknown_after_submit',
  'media_download_failed',
  'media_upload_failed',
  'content_mismatch',
  'deadline_expired',
  'policy_restriction',
  'target_mismatch',
  'ui_drift',
  'reauth_required',
  'device_offline',
])

export const checkpointSchema = z.object({
  jobId: uuid,
  leaseId: uuid,
  phase: localPublishPhaseSchema,
  observedAt: z.string().datetime({ offset: true }),
  failureCode: failureCodeSchema.optional(),
  providerReference: z.string().min(1).max(500).optional(),
  resultUrl: httpsUrl.optional(),
}).strict().superRefine((value, context) => {
  if (terminalFailurePhases.has(value.phase) && value.failureCode === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['failureCode'],
      message: '실패 checkpoint에는 정규화된 실패 코드가 필요합니다.',
    })
  }
  if (value.resultUrl !== undefined && !['result_observed', 'succeeded', 'unknown_after_submit'].includes(value.phase)) {
    context.addIssue({
      code: 'custom',
      path: ['resultUrl'],
      message: '결과 주소는 제출 이후 결과 단계에서만 기록할 수 있습니다.',
    })
  }
})

export type LocalPublishPhase = z.infer<typeof localPublishPhaseSchema>
export type LocalPublishJob = Readonly<z.infer<typeof localPublishJobSchema>>
export type LocalPublishCheckpoint = Readonly<z.infer<typeof checkpointSchema>>

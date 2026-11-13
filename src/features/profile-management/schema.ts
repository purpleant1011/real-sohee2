import { z } from 'zod'

const officialHosts = new Set(['help.naver.com', 'smartplace.naver.com', 'business.daangn.com'])

const officialSourceUrl = z.url().refine((value) => {
  try {
    return officialHosts.has(new URL(value).hostname)
  } catch {
    return false
  }
}, '공식 출처 URL만 사용할 수 있습니다.')

export const profileChangeProposalSchema = z.object({
  workspaceId: z.string().uuid(),
  channel: z.enum(['naver_place', 'daangn_business']),
  targetExternalId: z.string().min(1).max(255),
  targetLabel: z.string().min(1).max(255),
  field: z.enum(['business_name', 'business_hours', 'address', 'phone', 'introduction', 'news']),
  before: z.string().min(1).max(10_000),
  after: z.string().min(1).max(10_000),
  reason: z.string().min(1).max(1_000),
  capability: z.enum(['supervised_allowed', 'manual_assist_only', 'unsupported']),
  evidenceUrl: officialSourceUrl,
}).strict()

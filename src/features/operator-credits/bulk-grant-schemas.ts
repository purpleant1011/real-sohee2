import { z } from 'zod'

export const bulkAudienceSchema = z.object({
  audience: z.enum(['all_active', 'recent_signups']),
  recentDays: z.number().int().min(1).max(30).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.audience === 'recent_signups' && value.recentDays == null) ctx.addIssue({ code: 'custom', message: '최근 가입 기간을 입력해 주세요.' })
  if (value.audience === 'all_active' && value.recentDays != null) ctx.addIssue({ code: 'custom', message: '전체 대상에는 가입 기간을 지정할 수 없어요.' })
})

export const bulkGrantSchema = z.object({
  audience: z.enum(['all_active', 'recent_signups']),
  recentDays: z.number().int().min(1).max(30).nullable().optional(),
  amount: z.number().int().min(1).max(50000),
  reason: z.string().trim().min(1).max(2000),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,119}$/),
}).strict().superRefine((value, ctx) => {
  if (value.audience === 'recent_signups' && value.recentDays == null) ctx.addIssue({ code: 'custom', message: '최근 가입 기간을 입력해 주세요.' })
  if (value.audience === 'all_active' && value.recentDays != null) ctx.addIssue({ code: 'custom', message: '전체 대상에는 가입 기간을 지정할 수 없어요.' })
})

export type GrantInput = z.infer<typeof bulkGrantSchema>
export type AudienceInput = z.infer<typeof bulkAudienceSchema>
export type GrantResult = Readonly<{ campaign_id: string; target_count: number; granted_count: number; skipped_count: number }>
export type PreviewResult = Readonly<{ target_count: number; sample_names: string[] }>
export type Campaign = Readonly<{
  id: string; created_at: string; audience: 'all_active' | 'recent_signups'; recent_days: number | null
  amount_per_workspace: number; granted_count: number; skipped_count: number; reason: string
}>

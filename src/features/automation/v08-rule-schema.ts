import { z } from 'zod'
import type { AutomationRuleKind } from './rule-schema'

export const v08AutomationKinds = [
  'daily_performance_report', 'twice_daily_performance_report', 'weekly_plan_proposal',
  'connection_health_check', 'approved_schedule_readiness',
] as const
export type V08AutomationKind = (typeof v08AutomationKinds)[number]
export type SharedAutomationRuleKind = AutomationRuleKind | V08AutomationKind
export type V08AutomationChannel = 'instagram' | 'threads' | 'naver_blog' | 'naver_place' | 'daangn_business'

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const quietHoursSchema = z.object({ start: timeSchema, end: timeSchema }).strict()
const channels = z.array(z.enum(['instagram', 'threads', 'naver_blog', 'naver_place', 'daangn_business'])).min(1).max(5)

function validTimeZone(value: string): boolean {
  try { Intl.DateTimeFormat('en-US', { timeZone: value }).format() } catch { return false }
  return true
}

export function isWithinQuietHours(time: string, quietHours: z.infer<typeof quietHoursSchema>): boolean {
  if (quietHours.start === quietHours.end) return false
  if (quietHours.start < quietHours.end) return time >= quietHours.start && time < quietHours.end
  return time >= quietHours.start || time < quietHours.end
}

export const v08AutomationRuleSchema = z.object({
  kind: z.enum(v08AutomationKinds),
  active: z.boolean(),
  approvalRequired: z.literal(true),
  timezone: z.string().min(1).max(64).refine(validTimeZone, '유효한 IANA 시간대를 선택해 주세요.'),
  localTimes: z.array(timeSchema).min(1).max(2),
  weekday: z.number().int().min(0).max(6).optional(),
  quietHours: quietHoursSchema,
  perRunCreditCap: z.number().int().positive(),
  dailyCreditCap: z.number().int().positive(),
  weeklyCreditCap: z.number().int().positive(),
  channels,
}).strict().superRefine((value, context) => {
  const expectedTimes = value.kind === 'twice_daily_performance_report' ? 2 : 1
  if (value.localTimes.length !== expectedTimes) context.addIssue({ code: 'custom', path: ['localTimes'], message: '규칙 종류에 맞는 실행 시간을 입력해 주세요.' })
  if (new Set(value.localTimes).size !== value.localTimes.length) context.addIssue({ code: 'custom', path: ['localTimes'], message: '실행 시간은 서로 달라야 합니다.' })
  if (value.kind === 'weekly_plan_proposal' && value.weekday === undefined) context.addIssue({ code: 'custom', path: ['weekday'], message: '주간 제안의 요일을 선택해 주세요.' })
  if (value.kind !== 'weekly_plan_proposal' && value.weekday !== undefined) context.addIssue({ code: 'custom', path: ['weekday'], message: '주간 제안에만 요일을 설정할 수 있습니다.' })
  if (value.localTimes.some((time) => isWithinQuietHours(time, value.quietHours))) context.addIssue({ code: 'custom', path: ['localTimes'], message: '조용한 시간에는 실행할 수 없습니다.' })
  if (value.perRunCreditCap > value.dailyCreditCap || value.dailyCreditCap > value.weeklyCreditCap) context.addIssue({ code: 'custom', path: ['perRunCreditCap'], message: '크레딧 상한 순서를 확인해 주세요.' })
})

export type V08AutomationRuleInput = z.infer<typeof v08AutomationRuleSchema>
export type AutomationRunContext = Readonly<{ workspaceId: string; ruleId: string; scheduledFor: string; budgetPort: AutomationBudgetPort }>
export interface AutomationBudgetPort {
  previewAutomationBudget(input: Readonly<{ workspaceId: string; ruleId: string; scheduledFor: string }>): Promise<Readonly<{ allowed: boolean; reason: 'per_run_cap' | 'daily_cap' | 'weekly_cap' | 'balance' | null }>>
  reserveAutomationCredit(input: Readonly<{ workspaceId: string; ruleId: string; scheduledFor: string }>): Promise<Readonly<{ reservationId: string }>>
  settleAutomationCredit(input: Readonly<{ reservationId: string }>): Promise<void>
  releaseAutomationCredit(input: Readonly<{ reservationId: string; reason: 'collection_failed' | 'report_failed' | 'credit_settle_failed' }>): Promise<void>
}

function localParts(value: Date, formatter: Intl.DateTimeFormat) {
  const parts = formatter.formatToParts(value)
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return { time: `${read('hour')}:${read('minute')}`, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(read('weekday')) }
}

export function nextScheduledRun(rule: V08AutomationRuleInput, after: Date): Date {
  const candidate = new Date(after.getTime() + 60_000)
  candidate.setUTCSeconds(0, 0)
  const maxMinutes = 8 * 24 * 60
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: rule.timezone, hour12: false, hour: '2-digit', minute: '2-digit', weekday: 'short' })
  for (let index = 0; index < maxMinutes; index += 1) {
    const local = localParts(candidate, formatter)
    if (rule.localTimes.includes(local.time) && (rule.weekday === undefined || rule.weekday === local.weekday)) return new Date(candidate)
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1)
  }
  throw new Error('다음 자동화 실행 시간을 계산하지 못했습니다.')
}

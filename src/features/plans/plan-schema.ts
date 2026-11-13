import { z } from 'zod'
import { generationDepths, periodPlanChannels, type PeriodPlanRequest } from './types'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'PLAN_DATE_INVALID')
const timezoneSchema = z.string().trim().regex(/^[A-Za-z_]+(?:\/[A-Za-z_+-]+)+$/u, 'PLAN_TIMEZONE_INVALID')

const periodPlanChannelSchema = z.object({
  channel: z.enum(periodPlanChannels),
  postCount: z.number().int().min(1).max(100),
  imagesPerPost: z.number().int().min(0).max(20),
}).strict()

export const periodPlanRequestSchema = z.object({
  periodStart: dateSchema,
  periodEnd: dateSchema,
  timezone: timezoneSchema,
  goal: z.string().trim().min(1).max(500),
  channels: z.array(periodPlanChannelSchema).min(1).max(periodPlanChannels.length),
  generationDepth: z.enum(generationDepths),
  idempotencyKey: z.string().uuid(),
}).strict().superRefine((value, context) => {
  if (value.periodEnd < value.periodStart) {
    context.addIssue({ code: 'custom', message: 'PERIOD_END_BEFORE_START', path: ['periodEnd'] })
  }

  const channels = new Set<string>()
  for (const [index, channel] of value.channels.entries()) {
    if (channels.has(channel.channel)) {
      context.addIssue({ code: 'custom', message: 'PLAN_CHANNEL_DUPLICATE', path: ['channels', index, 'channel'] })
    }
    channels.add(channel.channel)
    if (channel.channel !== 'naver_blog' && channel.imagesPerPost > 10) {
      context.addIssue({ code: 'custom', message: 'PLAN_CHANNEL_IMAGE_LIMIT', path: ['channels', index, 'imagesPerPost'] })
    }
  }
})

export function parsePeriodPlanRequest(input: unknown): PeriodPlanRequest {
  return periodPlanRequestSchema.parse(input)
}

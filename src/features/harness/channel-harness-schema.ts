import { z } from 'zod'
import { supportedChannels } from '@/features/channels/channel-capabilities'

const text = (max: number) => z.string().min(1).max(max).refine((value) => value.trim().length > 0)
const factIds = z.array(z.string().uuid()).min(1).max(50)
const textRule = z.object({
  purpose: text(300), hook: text(300), structure: z.array(text(300)).min(1).max(12),
  tone: text(200), cta: text(500), prohibitedPhrases: z.array(text(200)).max(30),
}).strict()
const imageRule = z.object({
  aspectRatio: text(30), subject: text(500), composition: text(500), avoid: z.array(text(500)).min(1).max(30),
}).strict()

export const channelHarnessSchema = z.object({
  businessFacts: z.array(z.object({ factId: z.string().uuid(), statement: text(2000) }).strict()).min(1).max(50),
  persuasion: z.object({ audience: text(500), promise: text(1000), objections: z.array(text(500)).min(1).max(20) }).strict(),
  textByChannel: z.partialRecord(z.enum(supportedChannels), textRule).refine((value) => Object.keys(value).length > 0),
  imageByChannel: z.partialRecord(z.enum(supportedChannels), imageRule).refine((value) => Object.keys(value).length > 0),
  continuity: z.object({ series: text(300), recentTopics: z.array(text(300)).max(20), nextTopic: text(300), repetitionRisk: z.enum(['low', 'medium', 'high']) }).strict(),
  performanceLearning: z.object({ observedSignals: z.array(text(500)).max(30), hypothesis: text(1000) }).strict(),
  sourceFactIds: factIds,
  limitations: z.array(text(1000)).min(1).max(20),
}).strict().superRefine((value, context) => {
  const factIdsInLayer = new Set(value.businessFacts.map((fact) => fact.factId))
  if (value.sourceFactIds.some((id) => !factIdsInLayer.has(id))) {
    context.addIssue({ code: 'custom', path: ['sourceFactIds'], message: '출처 사실은 사업 사실 층에 포함되어야 합니다.' })
  }
})

export type ChannelHarness = z.infer<typeof channelHarnessSchema>

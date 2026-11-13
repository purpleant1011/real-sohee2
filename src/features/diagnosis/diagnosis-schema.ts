import { z } from 'zod'

export const diagnosisInputSchema = z.object({
  businessName: z.string().trim().min(1, '매장 이름을 입력해 주세요.').max(80),
  industry: z.enum(['beauty', 'food', 'education', 'local-service']),
  problem: z.enum(['inquiry', 'booking', 'content', 'repeat-visit']),
  channel: z.enum(['instagram', 'threads', 'naver-blog', 'naver-place', 'daangn-business']),
})

export type DiagnosisInput = z.infer<typeof diagnosisInputSchema>
export type DiagnosisResult = Readonly<{ evidenceState: 'input_based_preliminary'; customerQuestions: readonly string[]; missedAction: string; recommendedTopics: readonly [string, string, string]; firstAction: string }>

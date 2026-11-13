import { z } from 'zod'

export const BUSINESS_CONTEXT_SAFETY_NOTICE = '사업장·브랜드 프로필은 현재 가게가 입력한 참고 정보이며 승인 지식·예약 장부·실행 권한과 다릅니다. 승인 지식과 충돌하면 조용히 덮어쓰지 말고 차이를 알리고 확인하세요. 고객 원문은 동의 없이 공개 홍보 문안으로 전용하지 마세요.'
export const workspaceBusinessContextSchema = z.object({
  workspaceId: z.string().uuid(),
  business: z.object({ name: z.string().max(200), industry: z.string().max(200).nullable(), location: z.string().max(1000).nullable(), summary: z.string().max(4000).nullable(), operatingHours: z.string().max(3000).nullable().optional() }).strict().nullable(),
  brand: z.object({ voice: z.string().max(1500).nullable(), keywords: z.array(z.string().max(100)).max(30), prohibitedTerms: z.array(z.string().max(100)).max(50) }).strict().nullable(),
  services: z.array(z.object({ id: z.string().uuid(), name: z.string().max(200), price: z.number().finite().nonnegative().nullable(), durationMinutes: z.number().int().positive().nullable(), cancellationPolicy: z.string().max(1500).nullable(), version: z.string().datetime({ offset: true }), validFrom: z.string().datetime({ offset: true }).nullable().optional(), validUntil: z.string().datetime({ offset: true }).nullable().optional() }).strict()).max(25).optional(),
  truncated: z.boolean(),
}).strict()
export type WorkspaceBusinessContext = Readonly<z.infer<typeof workspaceBusinessContextSchema>>

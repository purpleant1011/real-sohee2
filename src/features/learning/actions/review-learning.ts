'use server'
import { z } from 'zod'
const schema=z.object({workspaceId:z.string().uuid(),candidateId:z.string().uuid(),decision:z.enum(['approve','reject']),expectedVersion:z.number().int().positive()}).strict()
export type LearningReviewRepository={review(value:Omit<z.infer<typeof schema>,'decision'>&{decision:'approved'|'rejected'}):Promise<'approved'|'rejected'|'workspace_conflict'|'version_conflict'>}
export async function reviewLearningAction(value:unknown,repo:LearningReviewRepository){const parsed=schema.safeParse(value);if(!parsed.success)return {data:{status:'invalid_input' as const}};const decision=parsed.data.decision==='approve'?'approved' as const:'rejected' as const;return {data:{status:await repo.review({...parsed.data,decision})}}}

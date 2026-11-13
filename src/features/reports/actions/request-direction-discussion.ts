'use server'
import { z } from 'zod'
const schema=z.object({workspaceId:z.string().uuid(),reportId:z.string().uuid(),direction:z.string().min(1).max(1000)}).strict()
export type DirectionDiscussionRepository={request(value:z.infer<typeof schema>):Promise<'requested'|'workspace_conflict'|'version_conflict'>}
export async function requestDirectionDiscussionAction(value:unknown,repo:DirectionDiscussionRepository){const parsed=schema.safeParse(value);if(!parsed.success)return {data:{status:'invalid_input' as const}};return {data:{status:await repo.request(parsed.data)}}}

'use server'

import { z } from 'zod'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { v08AutomationRuleSchema } from '../v08-rule-schema'

const controlSchema = z.object({
  workspaceId: z.string().uuid(),
  ruleId: z.string().uuid(),
  mode: z.enum(['pause', 'resume']),
  expectedVersion: z.number().int().positive(),
}).strict()
const saveSchema = z.object({
  workspaceId: z.string().uuid(),
  mode: z.literal('save'),
  configuration: v08AutomationRuleSchema,
}).strict()
const schema = z.union([controlSchema, saveSchema])

export type V08AutomationActionInput = z.infer<typeof schema>
export type AutomationActionRepository = Readonly<{
  save(value: V08AutomationActionInput): Promise<'saved' | 'paused' | 'resumed' | 'workspace_conflict' | 'version_conflict'>
}>

type Dependencies = Readonly<{
  workspace: typeof getCurrentWorkspaceContext
  repository: AutomationActionRepository
}>

export async function saveV08AutomationAction(
  value: unknown,
  providedDependencies?: Dependencies,
) {
  const parsed = schema.safeParse(value)
  if (!parsed.success) return { data: { status: 'invalid_input' as const } }
  if (parsed.data.mode === 'save' && parsed.data.configuration.active) {
    return { data: { status: 'invalid_input' as const } }
  }
  const workspace = providedDependencies?.workspace ?? getCurrentWorkspaceContext
  const current = await workspace()
  if (!current || current.workspaceId !== parsed.data.workspaceId || (current.role !== 'owner' && current.role !== 'manager')) {
    return { data: { status: 'forbidden' as const } }
  }
  const repository: AutomationActionRepository | null = providedDependencies?.repository ?? await (async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const server = await createServerSupabaseClient()
    const user = await server.auth.getUser()
    const actorUserId = user.data.user?.id
    if (user.error || typeof actorUserId !== 'string') return null
    const { createProductionV08AutomationRepository } = await import('../v08-automation-repository')
    return createProductionV08AutomationRepository(actorUserId)
  })()
  if (!repository) return { data: { status: 'forbidden' as const } }
  return { data: { status: await repository.save(parsed.data) } }
}

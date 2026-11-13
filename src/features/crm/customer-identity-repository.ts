import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'

const uuid = z.string().uuid()
const channelSchema = z.enum(['instagram', 'threads', 'naver_blog', 'naver_place'])
const subjectSchema = z.object({
  workspaceId: uuid, channel: channelSchema, externalSubjectId: z.string().trim().min(1).max(1000),
}).strict()
const rowSchema = z.object({
  id: uuid, workspace_id: uuid, channel: channelSchema,
  external_subject_reference_hash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
const membershipSchema = z.object({ workspace_id: uuid, user_id: uuid, status: z.literal('active') }).strict()
type QueryResult = Promise<{ data: unknown; error: unknown }>
export type CustomerIdentityGateway = {
  authorizeWorkspace(workspaceId: string): Promise<boolean>
  findBySubject(workspaceId: string, channel: z.infer<typeof channelSchema>, subjectHash: string): QueryResult
  findById(workspaceId: string, customerId: string): QueryResult
}
export type PersistedCustomerIdentityResult =
  | Readonly<{ status: 'FOUND'; identity: Readonly<{ workspaceId: string; customerId: string; channel: z.infer<typeof channelSchema> }> }>
  | Readonly<{ status: 'NOT_OBSERVED' | 'FORBIDDEN' | 'ERROR' }>

async function createGateway(): Promise<CustomerIdentityGateway> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const client = await createServerSupabaseClient()
  return {
    async authorizeWorkspace(workspaceId) {
      const { data: { user }, error } = await client.auth.getUser()
      if (error || !user) return false
      const membership = await client.from('workspace_members').select('workspace_id, user_id, status')
        .eq('workspace_id', workspaceId).eq('user_id', user.id).eq('status', 'active').maybeSingle()
      if (membership.error) return false
      const parsed = membershipSchema.safeParse(membership.data)
      return parsed.success && parsed.data.workspace_id === workspaceId && parsed.data.user_id === user.id
    },
    async findBySubject(workspaceId, channel, subjectHash) {
      return await client.from('customer_conversations')
        .select('id, workspace_id, channel, external_subject_reference_hash')
        .eq('workspace_id', workspaceId).eq('channel', channel).eq('external_subject_reference_hash', subjectHash).maybeSingle()
    },
    async findById(workspaceId, customerId) {
      return await client.from('customer_conversations')
        .select('id, workspace_id, channel, external_subject_reference_hash')
        .eq('workspace_id', workspaceId).eq('id', customerId).maybeSingle()
    },
  }
}

function readResult(result: { data: unknown; error: unknown }, workspaceId: string,
  matches: (row: z.infer<typeof rowSchema>) => boolean): PersistedCustomerIdentityResult {
  if (result.error) return { status: 'ERROR' }
  if (result.data === null) return { status: 'NOT_OBSERVED' }
  const parsed = rowSchema.safeParse(result.data)
  if (!parsed.success || parsed.data.workspace_id !== workspaceId || !matches(parsed.data)) return { status: 'ERROR' }
  return { status: 'FOUND', identity: { workspaceId, customerId: parsed.data.id, channel: parsed.data.channel } }
}

/** Existing conversation identity only, not an inferred cross-channel or global customer merge. */
export async function lookupPersistedCustomerIdentity(input: unknown, providedGateway?: CustomerIdentityGateway): Promise<PersistedCustomerIdentityResult> {
  const parsed = subjectSchema.safeParse(input)
  if (!parsed.success) return { status: 'ERROR' }
  const { workspaceId, channel, externalSubjectId } = parsed.data
  // Matches CustomerConversationService.normalizeSubjectToHash; provider IDs remain case-sensitive.
  const hash = createHash('sha256').update(externalSubjectId).digest('hex')
  try {
    const gateway = providedGateway ?? await createGateway()
    if (!await gateway.authorizeWorkspace(workspaceId)) return { status: 'FORBIDDEN' }
    return readResult(await gateway.findBySubject(workspaceId, channel, hash), workspaceId,
      row => row.channel === channel && row.external_subject_reference_hash === hash)
  } catch {
    return { status: 'ERROR' }
  }
}

export async function getPersistedCustomerIdentity(workspaceId: string, customerId: string, providedGateway?: CustomerIdentityGateway): Promise<PersistedCustomerIdentityResult> {
  if (!uuid.safeParse(workspaceId).success || !uuid.safeParse(customerId).success) return { status: 'ERROR' }
  try {
    const gateway = providedGateway ?? await createGateway()
    if (!await gateway.authorizeWorkspace(workspaceId)) return { status: 'FORBIDDEN' }
    return readResult(await gateway.findById(workspaceId, customerId), workspaceId, row => row.id === customerId)
  } catch {
    return { status: 'ERROR' }
  }
}

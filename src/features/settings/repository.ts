import { z } from 'zod'
import type { WorkspaceRole } from '@/features/auth/workspace-context'
import { channelNames, channelStatuses, memberStatuses, webhookStatuses, type SettingsLoadResult } from './types'

type QueryResult = Promise<{ data: unknown; error: unknown }>

export type SettingsGateway = {
  getCurrentUser(): QueryResult
  getBusiness(workspaceId: string): QueryResult
  getBrand(workspaceId: string): QueryResult
  listChannels(workspaceId: string): QueryResult
  listMembers(workspaceId: string): QueryResult
}

const uuidSchema = z.string().uuid()
const nullableTrimmed = (max: number) => z.string().trim().min(1).max(max).nullable()
const businessSchema = z.object({
  workspace_id: uuidSchema,
  business_name: z.string().trim().min(1).max(120),
  industry: nullableTrimmed(120),
  location: nullableTrimmed(200),
  summary: nullableTrimmed(4_000),
}).strict()
const brandSchema = z.object({
  workspace_id: uuidSchema,
  voice: nullableTrimmed(2_000),
  keywords: z.array(z.string().trim().min(1).max(100)).max(100),
  prohibited_terms: z.array(z.string().trim().min(1).max(100)).max(100),
}).strict()
const channelSchema = z.object({
  workspace_id: uuidSchema,
  channel: z.enum(channelNames),
  status: z.enum(channelStatuses),
  account_label: nullableTrimmed(120),
  token_expires_at: z.string().datetime({ offset: true }).nullable(),
  webhook_status: z.enum(webhookStatuses),
  last_webhook_at: z.string().datetime({ offset: true }).nullable(),
  last_error_code: z.string().max(120).nullable(),
}).strict()
const memberSchema = z.object({
  workspace_id: uuidSchema,
  user_id: uuidSchema,
  role: z.enum(['owner', 'manager', 'reviewer', 'viewer']),
  status: z.enum(memberStatuses),
}).strict()

function failure(): SettingsLoadResult {
  return { error: { message: '운영 설정을 불러오지 못했어요.' } }
}

async function createGateway(): Promise<SettingsGateway> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const supabase = await createServerSupabaseClient()
  return {
    getCurrentUser() {
      return supabase.auth.getUser()
    },
    async getBusiness(workspaceId) {
      return await supabase
        .from('business_profiles')
        .select('workspace_id, business_name, industry, location, summary')
        .eq('workspace_id', workspaceId)
        .maybeSingle()
    },
    async getBrand(workspaceId) {
      return await supabase
        .from('brand_profiles')
        .select('workspace_id, voice, keywords, prohibited_terms')
        .eq('workspace_id', workspaceId)
        .maybeSingle()
    },
    async listChannels(workspaceId) {
      return await supabase
        .from('channel_connections')
        .select('workspace_id, channel, status, account_label, token_expires_at, webhook_status, last_webhook_at, last_error_code')
        .eq('workspace_id', workspaceId)
        .order('channel', { ascending: true })
    },
    async listMembers(workspaceId) {
      return await supabase
        .from('workspace_members')
        .select('workspace_id, user_id, role, status')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: true })
    },
  }
}

export async function getOperationalSettings(
  workspaceId: string,
  role: WorkspaceRole,
  providedGateway?: SettingsGateway,
): Promise<SettingsLoadResult> {
  const parsedWorkspaceId = uuidSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) return failure()

  try {
    const gateway = providedGateway ?? await createGateway()
    const [userResult, businessResult, brandResult, channelResult, memberResult] = await Promise.all([
      gateway.getCurrentUser(),
      gateway.getBusiness(parsedWorkspaceId.data),
      gateway.getBrand(parsedWorkspaceId.data),
      gateway.listChannels(parsedWorkspaceId.data),
      gateway.listMembers(parsedWorkspaceId.data),
    ])
    const userId = uuidSchema.safeParse(
      (userResult.data as { user?: { id?: unknown } } | null)?.user?.id,
    )
    const business = businessResult.data === null ? null : businessSchema.safeParse(businessResult.data)
    const brand = brandResult.data === null ? null : brandSchema.safeParse(brandResult.data)
    const channels = z.array(channelSchema).safeParse(channelResult.data)
    const members = z.array(memberSchema).safeParse(memberResult.data)

    if (
      userResult.error || businessResult.error || brandResult.error || channelResult.error || memberResult.error
      || !userId.success
      || (business !== null && !business.success)
      || (brand !== null && !brand.success)
      || !channels.success
      || !members.success
    ) return failure()

    const channelsByName = new Map(channels.data.map((row) => [row.channel, row] as const))

    if (
      (business !== null && business.data.workspace_id !== parsedWorkspaceId.data)
      || (brand !== null && brand.data.workspace_id !== parsedWorkspaceId.data)
      || channels.data.some((row) => row.workspace_id !== parsedWorkspaceId.data)
      || members.data.some((row) => row.workspace_id !== parsedWorkspaceId.data)
    ) return failure()

    return {
      data: Object.freeze({
        business: Object.freeze({
          businessName: business?.data.business_name ?? '',
          industry: business?.data.industry ?? '',
          location: business?.data.location ?? '',
          summary: business?.data.summary ?? '',
        }),
        brand: Object.freeze({
          voice: brand?.data.voice ?? '',
          keywords: Object.freeze([...(brand?.data.keywords ?? [])]),
          prohibitedTerms: Object.freeze([...(brand?.data.prohibited_terms ?? [])]),
        }),
        channels: Object.freeze(channelNames.map((channel) => Object.freeze({
          channel,
          status: channelsByName.get(channel)?.status ?? 'disconnected',
          accountLabel: channelsByName.get(channel)?.account_label ?? null,
          tokenExpiresAt: channelsByName.get(channel)?.token_expires_at ?? null,
          webhookStatus: channelsByName.get(channel)?.webhook_status ?? 'pending',
          lastWebhookAt: channelsByName.get(channel)?.last_webhook_at ?? null,
          lastErrorCode: channelsByName.get(channel)?.last_error_code ?? null,
        }))),
        members: Object.freeze(members.data.map((row, index) => Object.freeze({
          memberId: row.user_id,
          label: row.user_id === userId.data ? '나' : `멤버 ${index + 1}`,
          role: row.role,
          status: row.status,
          current: row.user_id === userId.data,
        }))),
        permissions: Object.freeze({
          canEditProfiles: role === 'owner' || role === 'manager',
          canEditMembers: role === 'owner',
        }),
      }),
    }
  } catch {
    return failure()
  }
}

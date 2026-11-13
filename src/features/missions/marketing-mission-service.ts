import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import {
  MissionRepository,
  type CreateMissionParams,
  type TransitionMissionParams,
  type UpdateMissionLineageParams,
} from '@/lib/mission-os/mission-repository'
import {
  type MissionStatus,
  type MissionActorType,
  type MarketingMissionAggregate,
  normalizeActorType,
} from '@/lib/mission-os/mission-types'
import {
  MissionReadModel,
  type OwnerMissionView,
  type AdminMissionView,
} from '@/lib/mission-os/mission-read-model'

export interface EnsureMissionInput {
  workspaceId: string
  traceId: string
  goal: string
  sourceMessageId?: string | null
  sourceConversationJobId?: string | null
  strategySummary?: string | null
  targetChannel?: string | null
  targetAudience?: string | null
  actorType?: MissionActorType | string
  actorId?: string | null
  metadata?: Record<string, unknown>
}

export interface TransitionMissionInput {
  workspaceId: string
  missionId: string
  traceId: string
  toStatus: MissionStatus
  actorType?: MissionActorType | string
  actorId?: string | null
  reason?: string
  eventName?: string
  eventPayload?: Record<string, unknown>
  ownerActionRequired?: boolean
  downstreamUpdates?: Partial<Omit<MarketingMissionAggregate, 'id' | 'workspace_id' | 'trace_id' | 'status' | 'created_at' | 'updated_at'>>
}

export interface BindContentAndApprovalInput {
  workspaceId: string
  missionId: string
  traceId: string
  contentItemId?: string | null
  contentVersionId?: string | null
  approvalId?: string | null
  creativeBundleId?: string | null
}

export interface BindExternalActionInput {
  workspaceId: string
  missionId: string
  traceId: string
  actionRequestId?: string | null
  actionAttemptId?: string | null
  actionReceiptId?: string | null
  providerPostReference?: string | null
}

export class MarketingMissionService {
  private readonly repository: MissionRepository

  constructor(private readonly client: SupabaseClient<Database>) {
    this.repository = new MissionRepository(client)
  }

  /**
   * Idempotently resolves or creates a canonical marketing mission from a user command / message.
   */
  public async ensureMarketingMission(
    input: EnsureMissionInput
  ): Promise<MarketingMissionAggregate> {
    const {
      workspaceId,
      traceId,
      goal,
      sourceMessageId,
      sourceConversationJobId,
      strategySummary,
      targetChannel,
      targetAudience,
      actorType = 'user',
      actorId,
      metadata,
    } = input

    // 1. Idempotency Check: if sourceMessageId is provided, check if already created
    if (sourceMessageId) {
      const { data: existing } = await (this.client as any)
        .from('marketing_missions')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('source_message_id', sourceMessageId)
        .limit(1)
        .maybeSingle()

      if (existing) {
        return existing as MarketingMissionAggregate
      }
    }

    // 2. Create fresh canonical mission
    const createParams: CreateMissionParams = {
      workspaceId,
      traceId,
      goal,
      strategySummary,
      targetChannel,
      targetAudience,
      sourceMessageId,
      sourceConversationJobId,
      metadata,
      actorType: normalizeActorType(actorType),
      actorId,
    }

    return this.repository.createMission(createParams)
  }

  /**
   * Transitions mission to next lifecycle state with strict lineage and validation.
   */
  public async transitionMission(
    input: TransitionMissionInput
  ): Promise<MarketingMissionAggregate> {
    const isAwaitingApproval = input.toStatus === 'AWAITING_APPROVAL'
    const ownerActionRequired =
      input.ownerActionRequired !== undefined
        ? input.ownerActionRequired
        : isAwaitingApproval

    const params: TransitionMissionParams = {
      workspaceId: input.workspaceId,
      missionId: input.missionId,
      traceId: input.traceId,
      toStatus: input.toStatus,
      actorType: normalizeActorType(input.actorType),
      actorId: input.actorId,
      eventName: input.eventName || `MISSION_${input.toStatus}`,
      payload: {
        reason: input.reason,
        ...input.eventPayload,
      },
      downstreamUpdates: {
        metadata: {
          owner_action_required: ownerActionRequired,
        },
        ...input.downstreamUpdates,
      },
    }

    return this.repository.transitionMission(params)
  }

  /**
   * Binds the source conversation job (agent run ledger) to the canonical mission.
   */
  public async bindSourceConversationJob(input: {
    workspaceId: string
    missionId: string
    traceId: string
    sourceConversationJobId: string
  }): Promise<MarketingMissionAggregate> {
    const params: UpdateMissionLineageParams = {
      workspaceId: input.workspaceId,
      missionId: input.missionId,
      traceId: input.traceId,
      sourceConversationJobId: input.sourceConversationJobId,
      actorType: 'agent',
      reason: 'Bind source conversation job execution ledger',
    }

    return this.repository.updateMissionLineage(params)
  }

  /**
   * Binds downstream content and approval identifiers to the mission.
   */
  public async bindContentAndApproval(
    input: BindContentAndApprovalInput
  ): Promise<MarketingMissionAggregate> {
    const params: UpdateMissionLineageParams = {
      workspaceId: input.workspaceId,
      missionId: input.missionId,
      traceId: input.traceId,
      contentItemId: input.contentItemId,
      contentVersionId: input.contentVersionId,
      approvalId: input.approvalId,
      creativeBundleId: input.creativeBundleId,
      actorType: 'agent',
      reason: 'Bind content and approval lineage',
    }

    return this.repository.updateMissionLineage(params)
  }

  /**
   * Binds downstream external provider actions and receipts to the mission.
   */
  public async bindExternalAction(
    input: BindExternalActionInput
  ): Promise<MarketingMissionAggregate> {
    const params: UpdateMissionLineageParams = {
      workspaceId: input.workspaceId,
      missionId: input.missionId,
      traceId: input.traceId,
      actionRequestId: input.actionRequestId,
      actionAttemptId: input.actionAttemptId,
      actionReceiptId: input.actionReceiptId,
      providerPostReference: input.providerPostReference,
      actorType: 'system',
      reason: 'Bind external provider execution receipt',
    }

    return this.repository.updateMissionLineage(params)
  }

  /**
   * Binds customer conversation and booking identifiers to the mission.
   */
  public async bindCustomerAndBooking(input: {
    workspaceId: string
    missionId: string
    traceId: string
    customerId?: string | null
    bookingId?: string | null
    actorType?: MissionActorType | string
    reason?: string
  }): Promise<MarketingMissionAggregate> {
    const params: UpdateMissionLineageParams = {
      workspaceId: input.workspaceId,
      missionId: input.missionId,
      traceId: input.traceId,
      customerId: input.customerId,
      bookingId: input.bookingId,
      actorType: normalizeActorType(input.actorType || 'system'),
      reason: input.reason || 'Bind customer conversation and booking lineage',
    }

    return this.repository.updateMissionLineage(params)
  }

  /**
   * Returns a Same-Truth read projection for Owner or Admin.
   */
  public async getMissionProjection(
    workspaceId: string,
    missionId: string,
    audience: 'owner'
  ): Promise<OwnerMissionView>
  public async getMissionProjection(
    workspaceId: string,
    missionId: string,
    audience: 'admin'
  ): Promise<AdminMissionView>
  public async getMissionProjection(
    workspaceId: string,
    missionId: string,
    audience: 'owner' | 'admin'
  ): Promise<OwnerMissionView | AdminMissionView> {
    const mission = await this.repository.getMissionById(missionId, workspaceId)
    if (!mission) {
      throw new Error(`Mission not found: ${missionId} for workspace ${workspaceId}`)
    }

    if (audience === 'owner') {
      return MissionReadModel.toOwnerProjection(mission)
    }

    return MissionReadModel.toAdminProjection(mission)
  }

  /**
   * Lists active missions for a workspace.
   */
  public async listActiveMissions(
    workspaceId: string,
    limit = 20
  ): Promise<MarketingMissionAggregate[]> {
    return this.repository.listWorkspaceMissions(workspaceId, limit)
  }
}

/**
 * Mission Contract Registry & Verifiable Execution Contract (ANI-870)
 * 
 * Invariants:
 * 1. A mission is an executable, versioned contract — not just a vague count.
 * 2. Every mission must specify businessGoal, targetOutcome, safetyRules, and requiredPlugins.
 * 3. Every stage transition is tied to a correlation_id for complete traceability.
 */

export type MissionStage = 'PLAN' | 'EXECUTE' | 'VERIFY' | 'LEARN' | 'COMPLETED'
export type MissionStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'BLOCKED'

export interface MissionContract {
  missionId: string
  workspaceId: string
  version: number
  title: string
  businessGoal: string
  targetOutcome: string
  stage: MissionStage
  triggerCondition: string
  requiredPluginIds: string[]
  estimatedCreditCost: number
  safetyRules: string[]
  status: MissionStatus
  correlationId: string
  createdAt: string
  updatedAt: string
}

export interface ValidationResult {
  isValid: boolean
  errors: string[]
}

export function validateMissionContract(contract: Partial<MissionContract>): ValidationResult {
  const errors: string[] = []

  if (!contract.missionId || typeof contract.missionId !== 'string') {
    errors.push('missionId must be a non-empty string')
  }
  if (!contract.workspaceId || typeof contract.workspaceId !== 'string') {
    errors.push('workspaceId must be a non-empty string')
  }
  if (!contract.version || typeof contract.version !== 'number' || contract.version < 1) {
    errors.push('version must be a positive integer >= 1')
  }
  if (!contract.title || contract.title.trim().length === 0) {
    errors.push('title is required and cannot be empty')
  }
  if (!contract.businessGoal || contract.businessGoal.trim().length === 0) {
    errors.push('businessGoal is required to ensure outcome focus')
  }
  if (!contract.targetOutcome || contract.targetOutcome.trim().length === 0) {
    errors.push('targetOutcome is required')
  }

  const validStages: MissionStage[] = ['PLAN', 'EXECUTE', 'VERIFY', 'LEARN', 'COMPLETED']
  if (!contract.stage || !validStages.includes(contract.stage)) {
    errors.push(`stage must be one of: ${validStages.join(', ')}`)
  }

  const validStatuses: MissionStatus[] = ['ACTIVE', 'PAUSED', 'COMPLETED', 'BLOCKED']
  if (!contract.status || !validStatuses.includes(contract.status)) {
    errors.push(`status must be one of: ${validStatuses.join(', ')}`)
  }

  if (!Array.isArray(contract.requiredPluginIds)) {
    errors.push('requiredPluginIds must be an array')
  }

  if (contract.estimatedCreditCost === undefined || contract.estimatedCreditCost < 0) {
    errors.push('estimatedCreditCost must be a non-negative number')
  }

  if (!Array.isArray(contract.safetyRules) || contract.safetyRules.length === 0) {
    errors.push('safetyRules must contain at least one boundary rule')
  }

  if (!contract.correlationId || typeof contract.correlationId !== 'string') {
    errors.push('correlationId is required for traceable execution')
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

/**
 * @deprecated V0.91 Canon (ANI-1272):
 * MissionContractRegistry is for pure domain contract validation and test fixture simulation ONLY.
 * Production business SSOT is strictly delegated to `marketing-mission-service.ts` + Supabase durable repository.
 */
export class MissionContractRegistry {
  public readonly isTestOrDomainOnly = true;
  private missions = new Map<string, MissionContract>()

  public register(contract: MissionContract): void {
    const validation = validateMissionContract(contract)
    if (!validation.isValid) {
      throw new Error(`Invalid mission contract: ${validation.errors.join('; ')}`)
    }
    this.missions.set(contract.missionId, { ...contract })
  }

  public get(missionId: string): MissionContract | undefined {
    return this.missions.get(missionId)
  }

  public listByWorkspace(workspaceId: string): MissionContract[] {
    return Array.from(this.missions.values()).filter((m) => m.workspaceId === workspaceId)
  }

  public listActive(workspaceId: string): MissionContract[] {
    return this.listByWorkspace(workspaceId).filter((m) => m.status === 'ACTIVE')
  }

  public updateStage(missionId: string, stage: MissionStage, correlationId?: string): MissionContract {
    const existing = this.missions.get(missionId)
    if (!existing) {
      throw new Error(`Mission ${missionId} not found in registry`)
    }

    const updated: MissionContract = {
      ...existing,
      stage,
      correlationId: correlationId ?? existing.correlationId,
      updatedAt: new Date().toISOString(),
    }

    this.missions.set(missionId, updated)
    return updated
  }

  public clear(): void {
    this.missions.clear()
  }
}

export const defaultMissionContractRegistry = new MissionContractRegistry()

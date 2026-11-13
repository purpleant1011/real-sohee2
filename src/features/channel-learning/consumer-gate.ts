import type { SourceRef } from './contracts'

export interface ConsumerGateDeps {
  checkEpochAndLease: (
    workspaceId: string,
    epoch: number,
    dependencies: SourceRef[],
    purpose?: 'content' | 'conversation' | 'image',
  ) => Promise<boolean>
}

export function isChannelLearningEnabled(): boolean {
  return process.env.SOHEE_CHANNEL_LEARNING_ENABLED === '1'
}

export function filterApprovedContextForChannelLearning<T extends { source_type?: string }>(
  items: T[],
  enabled = isChannelLearningEnabled(),
): T[] {
  if (enabled) {
    return items
  }
  // Strip channel-derived knowledge when feature flag is off; strictly preserve manual & file knowledge
  return items.filter((item) => item.source_type !== 'channel')
}

export async function validateLearningResult(
  input: {
    workspaceId: string
    epoch: number
    dependencies: SourceRef[]
    purpose?: 'content' | 'conversation' | 'image'
  },
  deps: ConsumerGateDeps,
): Promise<boolean> {
  // If there are no channel dependencies (e.g. pure manual facts or empty), validation succeeds immediately
  if (!input.dependencies || input.dependencies.length === 0) {
    return true
  }

  // Verify all source dependencies belong to the same workspace
  for (const dep of input.dependencies) {
    if (dep.workspaceId !== input.workspaceId) {
      return false
    }
  }

  return deps.checkEpochAndLease(input.workspaceId, input.epoch, input.dependencies, input.purpose)
}

/**
 * Re-validates that sources referenced during generation are still active,
 * have not been revoked or deleted, revisions match, consent for purpose is preserved,
 * and OAuth connection is active.
 * Uses the authoritative, atomic database function `validate_learning_result`.
 */
export async function verifyDependenciesCurrent(
  client: any,
  workspaceId: string,
  expectedEpoch: number,
  dependencies: SourceRef[],
  purpose: 'content' | 'conversation' | 'image' = 'content',
): Promise<boolean> {
  if (!dependencies || dependencies.length === 0) {
    return true
  }

  if (!client || typeof client.rpc !== 'function') {
    return false
  }

  try {
    const { data, error } = await client.rpc('validate_learning_result', {
      p_workspace_id: workspaceId,
      p_expected_epoch: expectedEpoch,
      p_dependencies: dependencies,
      p_purpose: purpose,
    })

    if (error) {
      return false
    }

    return data === true
  } catch {
    return false
  }
}

export function createSupabaseConsumerGate(
  client: any,
  defaultPurpose: 'content' | 'conversation' | 'image' = 'content',
): ConsumerGateDeps {
  return {
    checkEpochAndLease: (workspaceId, epoch, dependencies, purpose) =>
      verifyDependenciesCurrent(client, workspaceId, epoch, dependencies, purpose ?? defaultPurpose),
  }
}

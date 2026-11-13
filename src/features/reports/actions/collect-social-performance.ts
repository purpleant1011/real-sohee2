'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { loadChannelCredential } from '@/features/channels/credential-repository'
import type { ActionResult } from '@/lib/errors/result'
import { collectMetaPostInsights } from '../meta-insights-provider'
import {
  loadPublishedMetricContext,
  loadSavedMetricSnapshot,
  saveMetricCollection,
  type SavedMetricSnapshot,
} from '../social-metric-repository'
import {
  executeSocialPerformanceCollection,
  type SocialPerformanceCollectionResult,
} from './collect-social-performance-core'

export type CollectSocialPerformanceResult = SocialPerformanceCollectionResult & {
  snapshot?: SavedMetricSnapshot | null
}

export async function collectSocialPerformanceAction(
  input: unknown,
): Promise<ActionResult<CollectSocialPerformanceResult>> {
  const workspaceId =
    typeof input === 'object' && input !== null && 'workspaceId' in input && typeof (input as { workspaceId: unknown }).workspaceId === 'string'
      ? (input as { workspaceId: string }).workspaceId
      : undefined

  const result = await executeSocialPerformanceCollection(input, {
    authorize: async (wsId) => getCurrentWorkspaceContext(wsId),
    loadContext: loadPublishedMetricContext,
    loadCredential: loadChannelCredential,
    collect: collectMetaPostInsights,
    save: saveMetricCollection,
    now: () => new Date(),
  })
  if (result.data) {
    revalidatePath('/app/reports')
    revalidatePath('/app/work')
    let snapshot: SavedMetricSnapshot | null = null
    if (workspaceId && result.data.collectionId) {
      snapshot = await loadSavedMetricSnapshot(workspaceId, result.data.collectionId).catch(() => null)
    }
    return {
      data: {
        ...result.data,
        snapshot,
      },
    }
  }
  return result
}

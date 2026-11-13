'use client'

import { useCallback } from 'react'
import type { FirstPostMissionDraft } from '@/features/missions/conversational-first-post'
import type { DraftDto } from './draft-mapper'
import { FirstPostFlow, type CopySaveInput } from './first-post-flow'
import { saveFirstPostDraftCopies } from './draft-save-client'
import { loadStoredFirstPostDraft } from './stored-draft-loader'

/** 불완전한 레거시 응답을 임의의 저장 가능한 draft로 메우지 않는다. */
export function isSavableFirstPostDraft(draft: DraftDto): draft is DraftDto & FirstPostMissionDraft {
  const raw = draft as DraftDto & Partial<FirstPostMissionDraft>
  return typeof raw.missionId === 'string' && typeof raw.workspaceId === 'string' &&
    raw.status === 'AWAITING_EXACT_APPROVAL' && typeof raw.createdAt === 'string' &&
    typeof raw.topic === 'string' && typeof raw.goal === 'string' &&
    typeof raw.copies?.instagram?.caption === 'string' && typeof raw.copies?.threads?.content === 'string' &&
    Array.isArray(raw.selectedImageIds) && raw.selectedImageIds.every(id => typeof id === 'string') &&
    !!raw.rights && !!raw.boundVersions && Array.isArray(raw.channels) &&
    typeof raw.approvalFingerprint === 'string' && /^[a-f0-9]{64}$/.test(raw.approvalFingerprint) &&
    raw.datasetMode === 'ACTUAL'
}

/** Entry와 미션 재진입 모두 같은 실제 revise → GET readback 저장 포트를 사용한다. */
export function StoredFirstPostFlow(props: { draft: DraftDto; workspaceId?: string; fetchImpl?: typeof fetch }) {
  const save = useCallback(async ({ draft, copies, signal }: CopySaveInput) => {
    if (!isSavableFirstPostDraft(draft) || draft.workspaceId !== props.workspaceId) return { kind: 'invalid' as const }
    return saveFirstPostDraftCopies({
      draft, copies, signal, fetchImpl: props.fetchImpl,
      readback: async (missionId, workspaceId, options) => {
        const result = await loadStoredFirstPostDraft({ missionId, workspaceId, fetchImpl: props.fetchImpl, signal: options?.signal })
        if (result.kind !== 'ready' || !['DRAFT', 'AWAITING_APPROVAL'].includes(result.missionStatus ?? '') || !isSavableFirstPostDraft(result.draft)) throw new Error('저장본을 확인하지 못했어요.')
        return result.draft
      },
    })
  }, [props.workspaceId, props.fetchImpl])
  const editable = isSavableFirstPostDraft(props.draft) && props.draft.workspaceId === props.workspaceId
  return <div className="mx-auto w-full min-w-0 max-w-md space-y-4 px-4 py-6"><FirstPostFlow {...props} onSaveCopy={editable ? save : undefined} /></div>
}

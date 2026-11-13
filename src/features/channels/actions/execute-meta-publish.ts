/**
 * P0-3 Production Execution Admission Action: execute-meta-publish
 * 
 * Enforces requireSoheeReady before executing any Meta publish side-effect.
 */
import { executeMetaPublish as baseExecuteMetaPublish, type MetaPublishExecutionInput, type MetaPublishExecutionResult } from '@/lib/external-actions/meta-action-executor'
import { requireSoheeReady } from '@/features/sohee-ready/admission-guard'

export async function executeMetaPublish(
  input: MetaPublishExecutionInput
): Promise<MetaPublishExecutionResult> {
  // P0-3: Strict requireSoheeReady Admission Guard
  try {
    await requireSoheeReady(input.workspaceId, { action: 'META_PUBLISH' })
    return await baseExecuteMetaPublish(input)
  } catch (readyErr: any) {
    if (readyErr?.code === 'SOHEE_NOT_READY') {
      return {
        success: false,
        verified: false,
        actionRequestId: '',
        attemptId: '',
        channel: input.channel,
        status: 'BLOCKED',
        errorCode: 'SOHEE_NOT_READY',
        message: readyErr.message,
        receipt: null,
      }
    }
    throw readyErr
  }
}

export { baseExecuteMetaPublish }
export type { MetaPublishExecutionInput, MetaPublishExecutionResult }

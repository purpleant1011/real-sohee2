import type {
  VaultEditChangesPayload,
  VaultEditResult,
} from './types'

export class VaultPatchError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export interface PatchVaultItemParams {
  workspaceId: string
  itemRef: string
  expectedVersion: string
  operation: 'edit' | 'replace_shared_image' | 'reapprove' | 'hold' | 'resume' | 'delete' | 'restore'
  changes?: VaultEditChangesPayload
  fetchFn?: typeof fetch
}

export async function patchVaultItem({
  workspaceId,
  itemRef,
  expectedVersion,
  operation,
  changes,
  fetchFn = globalThis.fetch,
}: PatchVaultItemParams): Promise<VaultEditResult> {
  const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/vault/${encodeURIComponent(itemRef)}`

  let response: Response
  try {
    response = await fetchFn(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operation,
        expectedVersion,
        ...(changes ? { changes } : {}),
      }),
    })
  } catch {
    throw new Error('보관 글을 변경하지 못했어요. 네트워크 연결을 확인해 주세요.')
  }

  let data: Record<string, unknown> | null = null
  try {
    data = (await response.json()) as Record<string, unknown>
  } catch {
    // Non-JSON response
  }

  if (!response.ok) {
    const errorMessage =
      typeof data?.error === 'string' && data.error.trim().length > 0
        ? data.error
        : '보관 글을 변경하지 못했어요. 잠시 후 다시 시도해 주세요.'
    throw new VaultPatchError(errorMessage, response.status)
  }

  if (
    !data ||
    typeof data.status_label !== 'string' ||
    typeof data.message !== 'string' ||
    typeof data.updated_at !== 'string' || !data.updated_at
  ) {
    throw new Error('서버 응답을 확인할 수 없어요. 잠시 후 다시 시도해 주세요.')
  }

  return {
    item_ref: (data.item_ref as string) || itemRef,
    status_label: data.status_label,
    message: data.message,
    updated_at: data.updated_at,
  }
}

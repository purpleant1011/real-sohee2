import { readVaultCopyFields } from '../bundle/content'
import { decodeItemRef, VaultEditError, type VaultEditRepository } from '../edit'
import type { VaultItem, VaultJson, VaultVariantPayload } from '../types'
import { toUserVaultItemDto } from './formatters'
import type { VaultItemDetailDto, VaultItemDetailMediaDto } from './types'

/** Same wording as the delete result and the editor badge. */
export const DELETED_STATUS_LABEL = '삭제됨 · 30일 안에 복구 가능'

function record(value: VaultJson | undefined): Record<string, VaultJson> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

/** Only the facts a preview and its channel check need: no digests, storage paths or URLs. */
function readMedia(raw: VaultJson | undefined): VaultItemDetailMediaDto[] {
  if (!Array.isArray(raw)) return []
  return raw
    .flatMap((entry, index) => {
      const row = record(entry)
      if (!row || (row.type !== 'image' && row.type !== 'video')) return []
      const position = typeof row.position === 'number' && Number.isFinite(row.position) ? row.position : Number.MAX_SAFE_INTEGER
      return [{
        order: [position, index] as const,
        media: {
          type: row.type,
          mime_type: typeof row.mimeType === 'string' ? row.mimeType : null,
          size_bytes: typeof row.sizeBytes === 'number' && Number.isFinite(row.sizeBytes) ? row.sizeBytes : null,
        } satisfies VaultItemDetailMediaDto,
      }]
    })
    .sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1])
    .map(({ media }) => media)
}

function text(value: VaultJson | undefined): string | null {
  return typeof value === 'string' ? value : null
}

export function toVaultItemDetailDto(item: VaultItem, variant: VaultVariantPayload): VaultItemDetailDto {
  const base = toUserVaultItemDto(item)
  const settings = record(variant.payload.settings)
  return {
    ...base,
    status_label: item.deletedAt ? DELETED_STATUS_LABEL : base.status_label,
    content: readVaultCopyFields(variant.payload),
    media: readMedia(variant.payload.media),
    settings: { category: text(settings?.category), coupon: text(settings?.coupon) },
    needs_reapproval: item.approvalState !== 'APPROVED',
    is_user_held: item.releaseGate === 'HELD_USER',
    is_deleted: item.deletedAt !== null,
    deleted_at: item.deletedAt,
  }
}

/** Read-only. Reuses the edit repository's workspace-scoped reads so the sheet and the PATCH see the same row. */
export async function getVaultItemDetail(
  repository: Pick<VaultEditRepository, 'getItem' | 'getPayload'>,
  input: { workspaceId: string; itemRef: string },
): Promise<VaultItemDetailDto> {
  const id = decodeItemRef(input.itemRef)
  const item = await repository.getItem(input.workspaceId, id)
  if (!item || item.workspaceId !== input.workspaceId) throw new VaultEditError(404, '보관 항목을 찾을 수 없어요.')
  const variant = await repository.getPayload(input.workspaceId, id)
  if (!variant || variant.workspaceId !== item.workspaceId) throw new VaultEditError(409, '보관 내용을 확인할 수 없어요.')
  return toVaultItemDetailDto(item, variant)
}

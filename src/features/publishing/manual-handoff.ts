import { createHash } from 'node:crypto'
import type { VaultChannel } from '@/features/vault/types'

export type ManualHandoffInput = {
  workspaceId: string
  actorId: string
  contentId: string
  versionId: string
  channel: VaultChannel
  confirmed?: boolean
}
export type ManualHandoffEvent = {
  id: string
  workspaceId: string
  itemId: string
  versionId: string
  fingerprint: string
  actorId: string
  occurredAt?: string
}
export interface ManualHandoffRepository {
  loadApprovedVersion(input: ManualHandoffInput): Promise<{ itemId: string; versionId: string; fingerprint: string } | null>
  readEvent(workspaceId: string, id: string): Promise<ManualHandoffEvent | null>
  putEvent(event: ManualHandoffEvent): Promise<void>
}
export type ManualHandoffView = {
  /** 이 보고가 붙은 보관 항목. 게시 주소 기록처럼 같은 항목을 다루는 후속 동작에 쓴다. */
  itemId: string
  state: 'NOT_RECORDED' | 'MANUAL_DELIVERED'
  label: string
  source: 'OWNER_REPORTED' | null
  providerVerified: false
  recordedAt: string | null
}
export class ManualHandoffError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: 'VAULT_ITEM_REQUIRED') { super(message) }
}

function eventId(input: ManualHandoffInput, itemId: string, fingerprint: string): string {
  const hex = createHash('sha256').update(JSON.stringify([
    'vault.manual_handoff_confirmed:v1', input.workspaceId, itemId, input.versionId, fingerprint,
  ])).digest('hex')
  // Stable UUID-shaped primary key makes retries converge on one immutable event.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export async function readManualHandoff(input: ManualHandoffInput, repository: ManualHandoffRepository): Promise<ManualHandoffView> {
  const item = await repository.loadApprovedVersion(input)
  if (!item || item.versionId !== input.versionId || !item.fingerprint) {
    throw new ManualHandoffError(409, '보관한 내용을 다시 확인해 주세요.', 'VAULT_ITEM_REQUIRED')
  }
  const id = eventId(input, item.itemId, item.fingerprint)
  const event = await repository.readEvent(input.workspaceId, id)
  if (!event) return { itemId: item.itemId, state: 'NOT_RECORDED', label: '수동 전달 기록 없음 · 외부 게시 전', source: null, providerVerified: false, recordedAt: null }
  if (event.id !== id || event.workspaceId !== input.workspaceId || event.itemId !== item.itemId ||
      event.versionId !== item.versionId || event.fingerprint !== item.fingerprint || !event.occurredAt || !event.actorId) {
    throw new ManualHandoffError(503, '수동 전달 기록을 확인하지 못했어요.')
  }
  return { itemId: item.itemId, state: 'MANUAL_DELIVERED', label: '수동 전달 완료 · 게시 미확인', source: 'OWNER_REPORTED', providerVerified: false, recordedAt: event.occurredAt }
}

/** Records only the owner's report. Never calls a provider or changes a publishing lifecycle. */
export async function recordManualHandoff(input: ManualHandoffInput, repository: ManualHandoffRepository): Promise<ManualHandoffView> {
  if (input.confirmed !== true) throw new ManualHandoffError(422, '직접 전달한 내용을 확인해 주세요.')
  const item = await repository.loadApprovedVersion(input)
  if (!item || item.versionId !== input.versionId || !item.fingerprint) {
    throw new ManualHandoffError(409, '보관한 내용을 다시 확인해 주세요.', 'VAULT_ITEM_REQUIRED')
  }
  await repository.putEvent({
    id: eventId(input, item.itemId, item.fingerprint), workspaceId: input.workspaceId,
    itemId: item.itemId, versionId: item.versionId, fingerprint: item.fingerprint, actorId: input.actorId,
  })
  const observed = await readManualHandoff(input, repository)
  if (observed.state !== 'MANUAL_DELIVERED') throw new ManualHandoffError(503, '수동 전달 기록을 확인하지 못했어요.')
  return observed
}

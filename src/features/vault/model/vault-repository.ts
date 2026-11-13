import type {
  VaultEvent,
  VaultItem,
  VaultPreflightRun,
  VaultVariantPayload,
} from '../types'

/** Reads are scoped to a single workspace (and to an active member at the RLS boundary). */
export interface VaultReader {
  getItem(workspaceId: string, itemId: string): Promise<VaultItem | null>
  listItems(workspaceId: string): Promise<readonly VaultItem[]>
  getVariantPayload(workspaceId: string, itemId: string): Promise<VaultVariantPayload | null>
  listEvents(workspaceId: string, itemId: string): Promise<readonly VaultEvent[]>
  listPreflightRuns(workspaceId: string, itemId: string): Promise<readonly VaultPreflightRun[]>
}

/** Server-held service-role credential only. Never expose this interface to client mutations. */
export interface VaultServiceRoleWriter {
  createItem(item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<VaultItem>
  updateItem(workspaceId: string, itemId: string, changes: Partial<Pick<
    VaultItem,
    'releaseGate' | 'holdReason' | 'heldAt' | 'heldBy' | 'targetDate' |
    'approvedFingerprint' | 'fingerprintSchemaVersion' | 'approvalState' |
    'approvedBy' | 'deletedAt' | 'policyVersion' | 'specVersion'
  >>): Promise<VaultItem>
  putVariantPayload(payload: Omit<VaultVariantPayload, 'id' | 'createdAt' | 'updatedAt'>): Promise<VaultVariantPayload>
  appendEvent(event: Omit<VaultEvent, 'id' | 'occurredAt'>): Promise<VaultEvent>
  recordPreflightRun(run: Omit<VaultPreflightRun, 'id' | 'runAt'>): Promise<VaultPreflightRun>
}

export type VaultServiceRoleRepository = VaultReader & VaultServiceRoleWriter

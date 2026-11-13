import type { VaultChannel, VaultItem } from '../types'
import type { VaultServiceRoleRepository } from './vault-repository'

export interface VaultDraftMedia {
  position: number
  type: 'image' | 'video'
  mimeType: string | null
  sizeBytes: number | null
  renditionContentDigest: string | null
}
export interface VaultDraft {
  workspaceId: string
  contentId: string
  versionId: string
  title: string
  caption: string
  hashtags: string[]
  validUntil: string | null
  media: VaultDraftMedia[]
}
export type ChannelTruth = Record<VaultChannel, { verified: boolean; accountId: string | null }>

/** Service-role only. Reads are workspace-scoped; writes never target publishing tables. */
export interface VaultSaveRepository extends Pick<VaultServiceRoleRepository, 'listItems' | 'getVariantPayload' | 'listEvents' | 'updateItem' | 'putVariantPayload' | 'appendEvent'> {
  getDraft(workspaceId: string, contentId: string, versionId: string): Promise<VaultDraft | null>
  getChannelTruth(workspaceId: string): Promise<ChannelTruth>
  getProviderReviewStatus(): Promise<'APPROVED' | 'PENDING' | 'REJECTED' | 'UNKNOWN'>
  findByIdempotencyKey(workspaceId: string, key: string): Promise<VaultItem | null>
  /** ON CONFLICT DO NOTHING + read existing, distinguishing winner from replay. */
  createItem(item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<{ item: VaultItem; created: boolean }>
}

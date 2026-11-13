export interface VaultImageRendition {
  id: string
  workspace_id: string
  vault_item_id: string
  source_media_asset_id: string
  channel: string
  storage_bucket: string
  object_path: string
  rendition_content_digest: string
  rights_expires_at: string | null
  qc_expires_at: string | null
}

export interface RenditionReader {
  /** Caller must scope the query by workspace and vault item; authorization also enforced by DB RLS. */
  list(workspaceId: string, vaultItemId: string): Promise<VaultImageRendition[]>
}

/** Preflight reads rights/QC expiry and digest, never a signed delivery URL. */
export async function readRenditions(reader: RenditionReader, workspaceId: string, vaultItemId: string): Promise<VaultImageRendition[]> {
  if (!workspaceId || !vaultItemId) throw new Error('Missing rendition lookup identity')
  const rows = await reader.list(workspaceId, vaultItemId)
  if (rows.some(row => row.workspace_id !== workspaceId || row.vault_item_id !== vaultItemId)) throw new Error('Rendition tenant mismatch')
  return rows
}

export interface RenditionSigner {
  createSignedUrl(bucket: string, objectPath: string, ttlSeconds: number): Promise<string>
}

/** Display-only operation; workspace and path must be bound before a privileged signer runs. */
export async function signRenditionForDisplay(row: VaultImageRendition, signer: RenditionSigner, ttlSeconds: number, workspaceId: string): Promise<string> {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 3600) throw new Error('Invalid signing TTL')
  if (!workspaceId || row.workspace_id !== workspaceId || row.storage_bucket !== 'content-media' ||
    !/^[a-f0-9]{64}$/.test(row.rendition_content_digest) ||
    row.object_path !== `vault-renditions/${workspaceId}/${row.rendition_content_digest}.jpg` &&
      row.object_path !== `vault-renditions/${workspaceId}/${row.rendition_content_digest}.png`) {
    throw new Error('Rendition workspace or object path mismatch')
  }
  return signer.createSignedUrl(row.storage_bucket, row.object_path, ttlSeconds)
}

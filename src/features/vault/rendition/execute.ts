import { createHash } from 'node:crypto'
import type { RenditionPlan } from './plan'

/** Injectable byte converter; use an infrastructure adapter to fetch/upload objects. */
export interface ImageTransformer {
  transform(input: Uint8Array, plan: Extract<RenditionPlan, { status: 'READY' }>): Promise<Uint8Array>
}

export interface RenditionRecordInput {
  workspace_id: string
  vault_item_id: string
  source_media_asset_id: string
  channel: string
  spec_version: string
  storage_bucket: string
  object_path: string
  format: 'jpeg' | 'png'
  width: number
  height: number
  rendition_content_digest: string
  rights_expires_at: string | null
  qc_expires_at: string | null
}

/** Only hash produced bytes, never the source digest or transformation parameters. */
export async function executeRendition(plan: Extract<RenditionPlan, { status: 'READY' }>, vaultItemId: string, input: Uint8Array, transformer: ImageTransformer): Promise<{ bytes: Uint8Array; renditionContentDigest: string; record: RenditionRecordInput }> {
  if (!vaultItemId) throw new Error('Missing vault item identity')
  const bytes = await transformer.transform(input, plan)
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('Invalid rendition bytes')
  if (plan.output.maxBytes !== null && bytes.byteLength > plan.output.maxBytes) throw new Error('Rendition exceeds channel size limit')
  const renditionContentDigest = createHash('sha256').update(bytes).digest('hex')
  const { source, output } = plan
  return {
    bytes,
    renditionContentDigest,
    record: {
      workspace_id: source.workspaceId, vault_item_id: vaultItemId, source_media_asset_id: source.id, channel: plan.channel,
      spec_version: plan.specVersion, storage_bucket: source.bucket,
      object_path: `vault-renditions/${source.workspaceId}/${renditionContentDigest}.${output.format === 'jpeg' ? 'jpg' : 'png'}`,
      format: output.format, width: output.width, height: output.height,
      rendition_content_digest: renditionContentDigest,
      rights_expires_at: source.rightsExpiresAt, qc_expires_at: source.qcExpiresAt,
    },
  }
}

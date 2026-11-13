import { readRenditions, signRenditionForDisplay } from '../rendition/repository'
import type {
  RenditionReader,
  RenditionSigner,
} from '../rendition/repository'
import { generateCopyBundle } from './generator'
import type { VaultBundleRepository } from './repository'
import type {
  RegisterPublishUrlInput,
  RegisterPublishUrlResult,
  VaultBundleImage,
  VaultCopyBundle,
} from './types'
import { canWriteVault, VAULT_WRITE_FORBIDDEN_MESSAGE } from '../permissions'
import { validatePublishUrl } from './validate-url'

export class VaultBundleError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'VaultBundleError'
  }
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function resolveVaultItemId(itemRef: string): string {
  const trimmed = itemRef.trim()
  if (UUID_REGEX.test(trimmed)) {
    return trimmed.toLowerCase()
  }

  if (/^[A-Za-z0-9_-]{22}$/.test(trimmed)) {
    try {
      const bytes = Buffer.from(trimmed, 'base64url')
      if (bytes.length === 16) {
        const hex = bytes.toString('hex')
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
      }
    } catch {
      // Fall through to error
    }
  }

  throw new VaultBundleError(404, '보관 항목을 확인할 수 없어요.')
}

export interface GetCopyBundleParams {
  workspaceId: string
  itemRef: string
  deps: {
    repository: VaultBundleRepository
    renditionReader: RenditionReader
    signer: RenditionSigner
    ttlSeconds?: number
  }
}

export async function getCopyBundle({
  workspaceId,
  itemRef,
  deps,
}: GetCopyBundleParams): Promise<VaultCopyBundle> {
  const itemId = resolveVaultItemId(itemRef)
  const item = await deps.repository.getItem(workspaceId, itemId)
  if (!item || item.workspaceId !== workspaceId) {
    throw new VaultBundleError(404, '보관 항목을 찾을 수 없어요.')
  }

  const [payload, renditionRows, manualPublish] = await Promise.all([
    deps.repository.getVariantPayload(workspaceId, itemId),
    readRenditions(deps.renditionReader, workspaceId, itemId),
    deps.repository.getPublishedUrl(workspaceId, itemId),
  ])

  const ttlSeconds = deps.ttlSeconds ?? 600

  // Generate ephemeral signed URLs on read. Ephemeral URLs are never persisted to repository.
  const signedImages: VaultBundleImage[] = await Promise.all(
    renditionRows.map(async (rendition, index) => {
      const signedUrl = await signRenditionForDisplay(rendition, deps.signer, ttlSeconds, workspaceId)

      const isPng = rendition.object_path.endsWith('.png')
      const ext = isPng ? 'png' : 'jpg'
      const format = isPng ? 'png' : 'jpeg'

      return {
        id: rendition.id,
        position: index,
        storageBucket: rendition.storage_bucket,
        objectPath: rendition.object_path,
        format,
        width: 1080,
        height: 1080,
        signedUrl,
        downloadFilename: `${item.channel}_image_${index + 1}.${ext}`,
      }
    }),
  )

  return generateCopyBundle({
    item,
    payload,
    signedImages,
    manualPublish,
    itemRef,
  })
}

export interface RegisterManualPublishUrlParams {
  input: RegisterPublishUrlInput
  deps: {
    repository: VaultBundleRepository
  }
}

export async function registerManualPublishUrl({
  input,
  deps,
}: RegisterManualPublishUrlParams): Promise<RegisterPublishUrlResult> {
  if (input.actorRole !== undefined && !canWriteVault(input.actorRole)) throw new VaultBundleError(403, VAULT_WRITE_FORBIDDEN_MESSAGE)
  const itemId = resolveVaultItemId(input.itemRef)
  const item = await deps.repository.getItem(input.workspaceId, itemId)
  if (!item || item.workspaceId !== input.workspaceId) {
    throw new VaultBundleError(404, '보관 항목을 찾을 수 없어요.')
  }

  const validation = validatePublishUrl(item.channel, input.url)
  if (!validation.valid) {
    throw new VaultBundleError(
      422,
      validation.error ?? '게시 주소를 확인해 주세요.',
    )
  }

  const savedRecord = await deps.repository.savePublishedUrl({
    workspaceId: input.workspaceId,
    vaultItemId: itemId,
    channel: item.channel,
    publishedUrl: validation.normalizedUrl,
    verificationStatus: 'UNVERIFIED',
    registeredBy: input.actorId,
  })

  await deps.repository.appendEvent({
    workspaceId: input.workspaceId,
    vaultItemId: itemId,
    actorId: input.actorId,
    eventType: 'vault.manual_publish_url_registered',
    payload: {
      channel: item.channel,
      publishedUrl: validation.normalizedUrl,
      verificationStatus: 'UNVERIFIED',
    },
  })

  return {
    success: true,
    publishedUrl: savedRecord.publishedUrl,
    statusLabel: '사장님이 직접 올린 글로 기록됐어요(확인 전)',
    registeredAt: savedRecord.createdAt,
  }
}

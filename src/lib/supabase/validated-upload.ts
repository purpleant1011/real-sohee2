import { createHash } from 'node:crypto'
import type { WorkspaceRole } from '@/features/auth/workspace-context'
import {
  validateContentMedia,
  validateKnowledgeFile,
  type FileValidationResult,
} from '@/features/knowledge/file-validation'
import { buildPrivateObjectPath, type PrivateStorageBucket } from './storage'

type UploadAssetRecord = {
  id: string
  workspace_id: string
  bucket_id: PrivateStorageBucket
  object_path: string
  kind: 'content' | 'knowledge'
  mime_type: string
  size_bytes: number
  sha256_digest: string
  rights_status: 'pending'
  created_by: string
}

type KnowledgeCheckingRecord = {
  id: string
  workspace_id: string
  media_asset_id: string
  name: string
  status: 'checking'
  evidence: { fileValidated: true }
  created_by: string
}

type ProviderResult = { error: unknown }

export type ValidatedUploadRepository = {
  registerAsset(record: UploadAssetRecord): Promise<ProviderResult>
  uploadObject(
    bucket: PrivateStorageBucket,
    path: string,
    file: Blob,
    options: { contentType: string; upsert: false },
  ): Promise<ProviderResult>
  registerKnowledgeChecking(record: KnowledgeCheckingRecord): Promise<ProviderResult>
  removeAsset(assetId: string): Promise<unknown>
  removeObject(bucket: PrivateStorageBucket, path: string): Promise<unknown>
}

type ValidatedUploadInput = {
  workspaceId: string
  userId: string
  resourceId: string
  bucket: PrivateStorageBucket
  role: WorkspaceRole
  file: File
}

type UploadFailureCode =
  | 'UPLOAD_FORBIDDEN'
  | 'UPLOAD_INPUT_INVALID'
  | 'UPLOAD_PROVIDER_FAILED'

export type ValidatedUploadResult =
  | Readonly<{
      ok: true
      assetId: string
      objectPath: string
      kind: 'content' | 'knowledge'
      status: 'pending' | 'checking'
    }>
  | Exclude<FileValidationResult, { ok: true }>
  | Readonly<{
      ok: false
      error: { code: UploadFailureCode; message: string }
    }>

const nativeObjectFreeze = Object.freeze
const nativeReflectApply = Reflect.apply
const nativeRegExpTest = RegExp.prototype.test
const NativeArrayBuffer = ArrayBuffer
const NativeBlob = Blob
const NativeUint8Array = Uint8Array
const nativeNumberIsSafeInteger = Number.isSafeInteger
const displayNamePattern = /^[^\u0000-\u001f\u007f/\\]{1,200}$/u

const safeErrors = nativeObjectFreeze({
  forbidden: nativeObjectFreeze({
    ok: false,
    error: nativeObjectFreeze({
      code: 'UPLOAD_FORBIDDEN',
      message: '이 작업공간에서는 파일을 업로드할 수 없습니다.',
    }),
  }),
  input: nativeObjectFreeze({
    ok: false,
    error: nativeObjectFreeze({
      code: 'UPLOAD_INPUT_INVALID',
      message: '업로드할 파일 정보를 확인해 주세요.',
    }),
  }),
  provider: nativeObjectFreeze({
    ok: false,
    error: nativeObjectFreeze({
      code: 'UPLOAD_PROVIDER_FAILED',
      message: '파일을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    }),
  }),
})

export async function uploadValidatedPrivateFile(
  input: ValidatedUploadInput,
  repository: ValidatedUploadRepository,
): Promise<ValidatedUploadResult> {
  let workspaceId: unknown
  let userId: unknown
  let resourceId: unknown
  let bucket: unknown
  let role: unknown
  let sourceFile: unknown

  try {
    workspaceId = input.workspaceId
    userId = input.userId
    resourceId = input.resourceId
    bucket = input.bucket
    role = input.role
    sourceFile = input.file
  } catch {
    return safeErrors.input
  }

  if (role !== 'owner' && role !== 'manager' && role !== 'reviewer') {
    return safeErrors.forbidden
  }

  if (bucket !== 'content-media' && bucket !== 'knowledge-files') {
    return safeErrors.input
  }

  const fileSnapshot = await snapshotFile(sourceFile)
  if (!fileSnapshot) return safeErrors.input
  const file = fileSnapshot.validationFile

  const validation =
    bucket === 'content-media'
      ? await validateContentMedia(file)
      : await validateKnowledgeFile(file)
  if (!validation.ok) return validation

  const extension = extensionFor(validation.kind)
  const assetKind = bucket === 'content-media' ? 'content' : 'knowledge'
  let objectPath: string

  try {
    objectPath = buildPrivateObjectPath({
      workspaceId: workspaceId as string,
      userId: userId as string,
      resourceId: resourceId as string,
      filename: `asset.${extension}`,
    })
  } catch {
    return safeErrors.input
  }

  try {
    const registered = await repository.registerAsset({
      id: resourceId as string,
      workspace_id: workspaceId as string,
      bucket_id: bucket,
      object_path: objectPath,
      kind: assetKind,
      mime_type: fileSnapshot.body.type,
      size_bytes: fileSnapshot.body.size,
      sha256_digest: fileSnapshot.sha256Digest,
      rights_status: 'pending',
      created_by: userId as string,
    })
    if (registered.error) return safeErrors.provider

    const uploaded = await repository.uploadObject(bucket, objectPath, fileSnapshot.body, {
      contentType: fileSnapshot.body.type,
      upsert: false,
    })
    if (uploaded.error) {
      await bestEffort(() => repository.removeAsset(resourceId as string))
      return safeErrors.provider
    }

    if (assetKind === 'knowledge') {
      const knowledge = await repository.registerKnowledgeChecking({
        id: resourceId as string,
        workspace_id: workspaceId as string,
        media_asset_id: resourceId as string,
        name: fileSnapshot.name,
        status: 'checking',
        evidence: { fileValidated: true },
        created_by: userId as string,
      })
      if (knowledge.error) {
        await bestEffort(() => repository.removeObject(bucket, objectPath))
        await bestEffort(() => repository.removeAsset(resourceId as string))
        return safeErrors.provider
      }
    }

    return nativeObjectFreeze({
      ok: true,
      assetId: resourceId as string,
      objectPath,
      kind: assetKind,
      status: assetKind === 'knowledge' ? 'checking' : 'pending',
    })
  } catch {
    await bestEffort(() => repository.removeObject(bucket, objectPath))
    await bestEffort(() => repository.removeAsset(resourceId as string))
    return safeErrors.provider
  }
}

async function snapshotFile(
  input: unknown,
): Promise<{ body: Blob; name: string; validationFile: File; sha256Digest: string } | null> {
  if ((typeof input !== 'object' && typeof input !== 'function') || input === null) return null

  try {
    const file = input as File
    const name = file.name
    const type = file.type
    const size = file.size
    const arrayBuffer = file.arrayBuffer

    if (
      typeof name !== 'string' ||
      !nativeReflectApply(nativeRegExpTest, displayNamePattern, [name]) ||
      typeof type !== 'string' ||
      !nativeNumberIsSafeInteger(size) ||
      size < 0 ||
      typeof arrayBuffer !== 'function'
    ) {
      return null
    }

    const bytes = await nativeReflectApply(arrayBuffer, file, [])
    if (!(bytes instanceof NativeArrayBuffer) || bytes.byteLength !== size) return null

    const immutableBytes = copyBytes(new NativeUint8Array(bytes))
    const validationFile = {
      name,
      type,
      size,
      slice(start = 0, end = immutableBytes.byteLength) {
        const sliced = copyBytes(immutableBytes, start, end)
        return { arrayBuffer: async () => sliced.buffer } as Blob
      },
      arrayBuffer: async () => copyBytes(immutableBytes).buffer,
    } as File

    return {
      name,
      body: new NativeBlob([immutableBytes.buffer as ArrayBuffer], { type }),
      validationFile,
      sha256Digest: createHash('sha256').update(immutableBytes).digest('hex'),
    }
  } catch {
    return null
  }
}

function copyBytes(source: Uint8Array, start = 0, end = source.byteLength): Uint8Array {
  const sourceLength = source.byteLength
  const safeStart =
    nativeNumberIsSafeInteger(start) && start > 0
      ? start < sourceLength
        ? start
        : sourceLength
      : 0
  const safeEnd =
    nativeNumberIsSafeInteger(end) && end >= safeStart
      ? end < sourceLength
        ? end
        : sourceLength
      : safeStart
  const copy = new NativeUint8Array(safeEnd - safeStart)
  for (let index = safeStart; index < safeEnd; index += 1) {
    copy[index - safeStart] = source[index] ?? 0
  }
  return copy
}

function extensionFor(kind: 'pdf' | 'text' | 'jpeg' | 'png' | 'webp'): string {
  if (kind === 'text') return 'txt'
  if (kind === 'jpeg') return 'jpg'
  return kind
}

async function bestEffort(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation()
  } catch {
    // The caller receives a fixed retry-safe error; cleanup failure is not exposed.
  }
}

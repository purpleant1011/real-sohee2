import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { PRIVATE_SIGNED_URL_SECONDS } from '@/lib/supabase/storage'
import { canUseAsEvidence, type KnowledgeStatus } from './knowledge-status'

type QueryResult = Promise<{ data: unknown; error: unknown }>

export type KnowledgeGateway = {
  listItems(workspaceId: string): QueryResult
  createSignedUrl(bucket: 'knowledge-files', objectPath: string): QueryResult
}

export type KnowledgeListItem = Readonly<{
  id: string
  name: string
  status: KnowledgeStatus
  mimeType: string
  sizeBytes: number
  fileUrl: string
  canUseAsEvidence: boolean
  createdAt: string
  updatedAt: string
}>

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime({ offset: true })
const statusSchema = z.enum([
  'uploading',
  'checking',
  'review_required',
  'approved',
  'rejected',
  'disabled',
])
const rowSchema = z
  .object({
    id: uuidSchema,
    workspace_id: uuidSchema,
    name: z.string().min(1).max(200),
    status: statusSchema,
    evidence: z.record(z.string(), z.unknown()),
    created_at: timestampSchema,
    updated_at: timestampSchema,
    media_assets: z
      .object({
        bucket_id: z.literal('knowledge-files'),
        object_path: z.string().min(1).max(800),
        mime_type: z.string().min(1).max(120),
        size_bytes: z.number().int().positive().max(8 * 1024 * 1024),
      })
      .strict(),
  })
  .strict()
const signedUrlSchema = z.object({ signedUrl: z.string().url() }).strict()

function failure<T>(): ActionResult<T> {
  return {
    error: {
      message: '지식 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
      requestId: 'knowledge-list',
    },
  }
}

async function createSupabaseGateway(): Promise<KnowledgeGateway> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const supabase = await createServerSupabaseClient()

  return {
    async listItems(workspaceId) {
      return supabase
        .from('knowledge_items')
        .select(
          'id, workspace_id, name, status, evidence, created_at, updated_at, media_assets!inner(bucket_id, object_path, mime_type, size_bytes)',
        )
        .eq('workspace_id', workspaceId)
        .order('updated_at', { ascending: false })
        .limit(100)
    },
    async createSignedUrl(bucket, objectPath) {
      return supabase.storage.from(bucket).createSignedUrl(objectPath, PRIVATE_SIGNED_URL_SECONDS)
    },
  }
}

export async function listKnowledgeItems(
  workspaceId: string,
  providedGateway?: KnowledgeGateway,
): Promise<ActionResult<readonly KnowledgeListItem[]>> {
  const parsedWorkspaceId = uuidSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) return failure()

  try {
    const gateway = providedGateway ?? (await createSupabaseGateway())
    const result = await gateway.listItems(parsedWorkspaceId.data)
    const rows = z.array(rowSchema).safeParse(result.data)
    if (
      result.error ||
      !rows.success ||
      rows.data.some((row) => row.workspace_id !== parsedWorkspaceId.data)
    ) {
      return failure()
    }

    const links = await Promise.all(
      rows.data.map((row) => gateway.createSignedUrl('knowledge-files', row.media_assets.object_path)),
    )
    const parsedLinks = links.map((link) => signedUrlSchema.safeParse(link.data))
    if (links.some((link) => link.error) || parsedLinks.some((link) => !link.success)) {
      return failure()
    }

    return {
      data: Object.freeze(
        rows.data.map((row, index) =>
          Object.freeze({
            id: row.id,
            name: row.name,
            status: row.status,
            mimeType: row.media_assets.mime_type,
            sizeBytes: row.media_assets.size_bytes,
            fileUrl: (parsedLinks[index] as { success: true; data: { signedUrl: string } }).data.signedUrl,
            canUseAsEvidence: canUseAsEvidence({ status: row.status }),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }),
        ),
      ),
    }
  } catch {
    return failure()
  }
}

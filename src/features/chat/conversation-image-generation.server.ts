import 'server-only'

import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import { BYREUM_IMAGE_HARNESS } from '@/features/harness/byreum-image-harness'
import {
  isByreumTestAccount,
  loadActiveByreumImageHarness,
} from '@/features/harness/byreum-image-harness-repository'
import {
  loadReferenceImages,
  type LoadedReferenceImage,
} from '@/features/image-style/reference-images'
import { loadWorkspaceImageStyle } from '@/features/image-style/workspace-image-style-repository'
import { readOpenAIImageConfig } from '@/lib/openai/server-env'
import {
  createOpenAIImageProvider,
  OpenAIImageProviderError,
} from '@/lib/providers/openai-image-provider'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { uploadValidatedPrivateFile } from '@/lib/supabase/validated-upload'
import { createValidatedUploadRepository } from '@/lib/supabase/validated-upload-repository'
import {
  generateConversationImageArtifact,
  generateConversationImageBatchArtifacts,
  type ConversationImageBatchGenerationDependencies,
  type ConversationImageBatchGenerationInput,
  type ConversationImageGenerationDependencies,
  type ConversationImageGenerationInput,
} from './conversation-image-generation'

function copyAsArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function createProductionGenerationDependencies(): ConversationImageGenerationDependencies {
  const admin = createAdminSupabaseClient()
  const config = readOpenAIImageConfig()
  const provider = createOpenAIImageProvider(new OpenAI({ apiKey: config.apiKey }), config.model)
  let authorizedEmail: string | null = null

  return {
    async authorize({ workspaceId, userId }) {
      const [membership, user] = await Promise.all([
        admin.from('workspace_members').select('role, status')
          .eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle(),
        admin.auth.admin.getUserById(userId),
      ])
      if (membership.error || membership.data?.status !== 'active') return null
      if (membership.data.role !== 'owner' && membership.data.role !== 'manager') return null
      authorizedEmail = user.error ? null : user.data.user?.email ?? null
      return { role: membership.data.role, email: authorizedEmail }
    },
    async loadHarness({ workspaceId, channel }) {
      const active = await loadActiveByreumImageHarness({ client: admin, workspaceId, channel })
        .catch(() => { throw new Error('CHAT_IMAGE_HARNESS_UNAVAILABLE') })
      if (active?.harness) return active.harness
      return isByreumTestAccount(authorizedEmail) ? BYREUM_IMAGE_HARNESS : null
    },
    loadWorkspaceStyle(workspaceId) {
      return loadWorkspaceImageStyle(admin, workspaceId)
    },
    async generate(request) {
      const requestedIds = request.referenceAssetIds
        ? Array.from(new Set(request.referenceAssetIds.filter((id) => typeof id === 'string' && id.length > 0)))
        : []
      let references: LoadedReferenceImage[] = []
      if (requestedIds.length > 0) {
        if (!request.workspaceId) {
          throw new OpenAIImageProviderError(
            '기준 사진을 불러오거나 반영하지 못했습니다.',
            'IMAGE_REFERENCE_UNAVAILABLE',
          )
        }
        references = await loadReferenceImages(admin, request.workspaceId, requestedIds)
        if (references.length !== requestedIds.length) {
          throw new OpenAIImageProviderError(
            '기준 사진을 불러오거나 반영하지 못했습니다.',
            'IMAGE_REFERENCE_UNAVAILABLE',
          )
        }
      }
      return provider.generate({
        prompt: request.prompt,
        size: request.size,
        ...(references.length > 0 ? { references } : {}),
      })
    },
    async store({ workspaceId, userId, role, bytes, mimeType }) {
      const assetId = randomUUID()
      const file = new File([copyAsArrayBuffer(bytes)], 'sohee-conversation-image.png', {
        type: mimeType,
      })
      const uploaded = await uploadValidatedPrivateFile({
        workspaceId,
        userId,
        resourceId: assetId,
        bucket: 'content-media',
        role,
        file,
      }, createValidatedUploadRepository(admin))
      if (!uploaded.ok) throw new Error('CHAT_IMAGE_STORE_FAILED')

      const confirmed = await admin.from('media_assets')
        .update({ rights_status: 'confirmed' })
        .eq('workspace_id', workspaceId)
        .eq('id', assetId)
        .eq('rights_status', 'pending')
        .select('id')
        .maybeSingle()
      if (confirmed.error || confirmed.data?.id !== assetId) {
        throw new Error('CHAT_IMAGE_CONFIRM_FAILED')
      }
      return { assetId }
    },
  }
}

export async function createProductionConversationImageArtifact(
  input: ConversationImageGenerationInput,
) {
  return generateConversationImageArtifact({ ...input, allowNeutralFallback: input.allowNeutralFallback ?? true }, createProductionGenerationDependencies())
}

export async function createProductionConversationImageBatchArtifacts(
  input: ConversationImageBatchGenerationInput,
) {
  const dependencies: ConversationImageBatchGenerationDependencies = {
    ...createProductionGenerationDependencies(),
    createSlideId: () => randomUUID(),
  }
  return generateConversationImageBatchArtifacts({ ...input, allowNeutralFallback: input.allowNeutralFallback ?? true }, dependencies)
}

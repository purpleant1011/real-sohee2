import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import type { ValidatedUploadRepository } from './validated-upload'

export function createValidatedUploadRepository(
  client: SupabaseClient<Database>,
): ValidatedUploadRepository {
  return {
    async registerAsset(record) {
      const { error } = await client.from('media_assets').insert(record)
      return { error }
    },

    async uploadObject(bucket, path, file, options) {
      const { error } = await client.storage.from(bucket).upload(path, file, options)
      return { error }
    },

    async registerKnowledgeChecking(record) {
      const { error } = await client.from('knowledge_items').insert(record)
      return { error }
    },

    async removeAsset(assetId) {
      await client.from('media_assets').delete().eq('id', assetId)
    },

    async removeObject(bucket, path) {
      await client.storage.from(bucket).remove([path])
    },
  }
}

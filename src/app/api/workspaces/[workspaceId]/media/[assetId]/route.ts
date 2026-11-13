export const dynamic = 'force-dynamic';
import { z } from 'zod'
import type { PrivateStorageBucket } from '@/lib/supabase/storage'

type RouteContext = Readonly<{
  params: Promise<{ workspaceId: string; assetId: string }>
}>

type AuthorizedAsset = Readonly<{
  bucket: PrivateStorageBucket
  objectPath: string
}>

type AuthorizedAssetResult =
  | Readonly<{ kind: 'authorized'; asset: AuthorizedAsset }>
  | Readonly<{ kind: 'auth_required' }>
  | Readonly<{ kind: 'not_found' }>

export type MediaGetDependencies = Readonly<{
  resolveAuthorizedAsset(input: {
    workspaceId: string
    assetId: string
  }): Promise<AuthorizedAssetResult>
  createSignedUrl(asset: AuthorizedAsset): Promise<string>
}>

const uuidSchema = z.string().uuid()

function notFound() {
  return Response.json({ error: { code: 'MEDIA_NOT_FOUND' } }, {
    status: 404,
    headers: { 'cache-control': 'private, no-store' },
  })
}

export function createMediaGetHandler(dependencies: MediaGetDependencies) {
  return async function get(_request: Request, context: RouteContext): Promise<Response> {
    const rawParams = await context.params
    const workspaceId = uuidSchema.safeParse(rawParams.workspaceId)
    const assetId = uuidSchema.safeParse(rawParams.assetId)
    if (!workspaceId.success || !assetId.success) return notFound()

    try {
      const resolved = await dependencies.resolveAuthorizedAsset({
        workspaceId: workspaceId.data,
        assetId: assetId.data,
      })
      if (resolved.kind === 'auth_required') {
        return Response.json({ error: { code: 'AUTH_REQUIRED' } }, {
          status: 401,
          headers: { 'cache-control': 'private, no-store' },
        })
      }
      if (resolved.kind === 'not_found') return notFound()

      const signedUrl = await dependencies.createSignedUrl(resolved.asset)
      const parsedUrl = new URL(signedUrl)
      if (parsedUrl.protocol !== 'https:') return notFound()

      return new Response(null, {
        status: 307,
        headers: {
          location: parsedUrl.toString(),
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        },
      })
    } catch {
      return notFound()
    }
  }
}

const productionDependencies: MediaGetDependencies = {
  async resolveAuthorizedAsset({ workspaceId, assetId }) {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const client = await createServerSupabaseClient()
    const user = await client.auth.getUser()
    const userId = user.error ? null : user.data.user?.id ?? null
    if (userId === null) return { kind: 'auth_required' }
    const [membership, asset] = await Promise.all([
      client.from('workspace_members').select('workspace_id')
        .eq('workspace_id', workspaceId).eq('user_id', userId).eq('status', 'active').maybeSingle(),
      client.from('media_assets').select('bucket_id, object_path')
        .eq('workspace_id', workspaceId).eq('id', assetId).eq('kind', 'content').maybeSingle(),
    ])
    if (membership.error || asset.error || !membership.data || !asset.data) return { kind: 'not_found' }
    if (asset.data.bucket_id !== 'content-media') return { kind: 'not_found' }
    return { kind: 'authorized', asset: { bucket: 'content-media', objectPath: asset.data.object_path } }
  },
  async createSignedUrl(asset) {
    const [{ createAdminSupabaseClient }, { createPrivateSignedUrl }] = await Promise.all([
      import('@/lib/supabase/admin'),
      import('@/lib/supabase/storage'),
    ])
    return createPrivateSignedUrl(createAdminSupabaseClient(), asset.bucket, asset.objectPath)
  },
}

export const GET = createMediaGetHandler(productionDependencies)

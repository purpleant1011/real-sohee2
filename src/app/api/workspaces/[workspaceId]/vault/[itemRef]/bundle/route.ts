export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { VAULT_WRITE_FORBIDDEN_MESSAGE } from '@/features/vault/permissions'
import {
  getCopyBundle,
  registerManualPublishUrl,
  VaultBundleError,
} from '@/features/vault/bundle/service'
import {
  SupabaseVaultBundleRepository,
  createSupabaseRenditionReader,
  createSupabaseRenditionSigner,
} from '@/features/vault/bundle/repository'

const registerSchema = z
  .object({
    url: z.string().min(1, '게시 주소를 입력해 주세요.'),
  })
  .strict()

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; itemRef: string }> },
) {
  const { workspaceId, itemRef } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) return auth

    const repo = new SupabaseVaultBundleRepository(auth.admin)
    const renditionReader = createSupabaseRenditionReader(auth.admin)
    const signer = createSupabaseRenditionSigner(auth.admin)

    const bundle = await getCopyBundle({
      workspaceId: auth.workspaceId,
      itemRef,
      deps: {
        repository: repo,
        renditionReader,
        signer,
      },
    })

    return NextResponse.json(bundle, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    if (error instanceof VaultBundleError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[vault.bundle] GET request failed', error)
    return NextResponse.json(
      { error: '번들 정보를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    )
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; itemRef: string }> },
) {
  const { workspaceId, itemRef } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager', forbiddenMessage: VAULT_WRITE_FORBIDDEN_MESSAGE })
    if (isResponse(auth)) return auth

    const json = await request.json().catch(() => null)
    const parsed = registerSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: '게시 주소를 입력해 주세요.' },
        { status: 422 },
      )
    }

    const repo = new SupabaseVaultBundleRepository(auth.admin)
    const result = await registerManualPublishUrl({
      input: {
        workspaceId: auth.workspaceId,
        itemRef,
        actorId: auth.userId,
        actorRole: auth.role,
        url: parsed.data.url,
      },
      deps: { repository: repo },
    })

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    if (error instanceof VaultBundleError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[vault.bundle] POST request failed', error)
    return NextResponse.json(
      { error: '게시 주소를 등록하지 못했어요. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    )
  }
}

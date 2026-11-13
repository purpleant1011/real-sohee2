export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { resolveDeterministicWorkspace } from '@/features/auth/workspace-context'
import {
  getPersistedChannelVerification,
  evaluateDualChannelReadiness,
  type ChannelVerificationResult,
} from '@/features/channels/dual-channel-verification'
import {
  getPersistedBrowserChannelState,
  type BrowserChannelState,
} from '@/features/channels/browser-channel-verification'
import { isPublishSupported, type PublishSupportChannelId } from '@/features/channels/supported-publish'
import { isExtendedMetaScopeAllowed } from '@/features/channels/oauth/extended-scope-gate'

/**
 * [ANI-1776] 네이버 플레이스는 서버에 영속 연결 근거가 없다(등록·검증 경로 모두 없음).
 * 근거 없는 상태를 만들지 않고 UNKNOWN 으로 고정한다.
 */
const NAVER_PLACE_UNKNOWN: BrowserChannelState = {
  status: 'UNKNOWN',
  verified: false,
  blockerMessage: '네이버 플레이스는 아직 연결 상태를 확인할 수 없습니다.',
  accountLabel: null,
  connectedAccountMatches: null,
  lastCheckedAt: null,
}

function toBrowserChannelEntry(channel: PublishSupportChannelId, state: BrowserChannelState) {
  return {
    status: state.status,
    verified: state.verified,
    supportedPublish: isPublishSupported(channel),
    blockerMessage: state.blockerMessage,
    accountLabel: state.accountLabel,
    connectedAccountMatches: state.connectedAccountMatches,
    lastCheckedAt: state.lastCheckedAt ?? null,
  }
}

function toMetaChannelEntry(channel: 'instagram' | 'threads', result: ChannelVerificationResult) {
  return {
    status: result.status,
    verified: result.verified,
    supportedPublish: isPublishSupported(channel),
    blockerMessage: result.blockerMessage,
    username: (result.evidence as any)?.username,
    accountId: (result.evidence as any)?.accountId,
    expiresAt: (result.evidence as any)?.tokenExpiresAt,
    scopes: (result.evidence as any)?.scopes,
    lastCheckedAt: result.lastCheckedAt ?? null,
  }
}

/**
 * P0-6: GET /api/channels READ TRUTH ALIGNMENT
 * 
 * Provides unified, single-source-of-truth channel status matching getSoheeReadiness.
 * Returns verified=true ONLY when real credentials + active status + 24h validity +
 * required scopes + recent (<7d) verification run exist in database.
 */
export async function GET(request?: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 })
    }

    const requestedWorkspaceId = request?.nextUrl?.searchParams?.get('workspaceId') || request?.nextUrl?.searchParams?.get('workspace_id')

    const resolved = await resolveDeterministicWorkspace({
      supabase,
      userId: user.id,
      userEmail: user.email,
      requestedWorkspaceId,
    })

    if (!resolved.success) {
      return NextResponse.json(
        { error: resolved.statusCode === 404 ? '워크스페이스를 찾을 수 없습니다.' : resolved.message },
        { status: resolved.statusCode }
      )
    }

    const workspaceId = resolved.workspaceId

    // [HF-38] Server-Only Credential Truth Boundary
    // User session is used above for AuthN & workspace membership AuthZ.
    // Sensitive credentials and verification runs are queried via server-only admin boundary.
    const [instagram, threads, naverBlog, daangn] = await Promise.all([
      getPersistedChannelVerification(workspaceId, 'instagram'),
      getPersistedChannelVerification(workspaceId, 'threads'),
      getPersistedBrowserChannelState(workspaceId, 'naver_blog'),
      getPersistedBrowserChannelState(workspaceId, 'daangn_business'),
    ])

    const readiness = evaluateDualChannelReadiness({ instagram, threads })

    const extendedScopesAllowed = isExtendedMetaScopeAllowed({
      workspaceId,
      role: resolved.role,
      extended: true,
    })

    return NextResponse.json({
      success: true,
      workspaceId,
      extendedScopesAllowed,
      instagram: toMetaChannelEntry('instagram', instagram),
      threads: toMetaChannelEntry('threads', threads),
      naverBlog: toBrowserChannelEntry('naver_blog', naverBlog),
      naverPlace: toBrowserChannelEntry('naver_place', NAVER_PLACE_UNKNOWN),
      daangn: toBrowserChannelEntry('daangn', daangn),
      dualVerified: readiness.dualVerified,
      blockers: readiness.blockers,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    })
  } catch (err: unknown) {
    console.error('[GET /api/channels error]:', err)
    return NextResponse.json(
      { error: (err as Error).message || '채널 정보를 조회하지 못했습니다.' },
      { status: 500 }
    )
  }
}

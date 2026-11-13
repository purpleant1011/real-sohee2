export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { CanonicalContentLifecycleService } from '@/features/content/canonical-content-lifecycle'
import { PersistenceError } from '@/lib/errors/persistence-error'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; contentId: string }> }
) {
  const { workspaceId, contentId } = await params

  // Cross-tenant guard: refuse a non-member before revising (writing) workspace content.
  const auth = await authorizeQuickRequest(workspaceId)
  if (isResponse(auth)) return auth

  try {
    const body = await request.json().catch(() => ({}))
    const { expectedVersionId, caption, hashtags, mediaUrls, revisionReason } = body

    if (!expectedVersionId) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_PARAMETERS', message: 'expectedVersionId가 필수입니다.' },
      }, { status: 400 })
    }

    if (!caption || typeof caption !== 'string' || !caption.trim()) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_CAPTION', message: '수정할 본문(caption)이 필요합니다.' },
      }, { status: 400 })
    }

    const revised = await CanonicalContentLifecycleService.reviseContent({
      workspaceId,
      contentId,
      expectedVersionId,
      caption,
      hashtags,
      mediaUrls,
      revisionReason: revisionReason || '',
      createdBy: auth.userId,
    })

    return NextResponse.json({
      success: true,
      content: revised,
    }, { status: 200 })
  } catch (err: unknown) {
    console.error('[Content Revisions API] POST error:', err)
    if (err instanceof PersistenceError) {
      const statusCode = err.code === 'STALE_VERSION_CONFLICT' ? 409 : 400
      return NextResponse.json({
        success: false,
        error: {
          code: err.code || 'REVISION_FAILED',
          message: err.message,
        },
      }, { status: statusCode })
    }
    return NextResponse.json({
      success: false,
      error: {
        code: 'REVISE_CONTENT_FAILED',
        message: (err as Error).message || '콘텐츠 수정에 실패했습니다.',
      },
    }, { status: 500 })
  }
}

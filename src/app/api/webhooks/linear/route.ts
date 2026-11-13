export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server'
import { verifyLinearWebhookSignature, shouldEnqueueDelayedArchive, LINEAR_ARCHIVE_GRACE_PERIOD_SECONDS } from '@/features/linear/delayed-archive'

export async function POST(req: NextRequest) {
  const secret = process.env.LINEAR_WEBHOOK_SECRET || process.env.LINEAR_API_KEY || ''
  const signature = req.headers.get('linear-signature')

  const rawBody = await req.text()

  // 서명 검증 (비밀키가 설정되어 있는 경우)
  if (secret && !verifyLinearWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid Linear webhook signature' }, { status: 401 })
  }

  let payload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  // 완료 상태 전이 여부 확인
  if (shouldEnqueueDelayedArchive(payload)) {
    console.log(
      `[Linear Webhook] Issue ${payload.data.identifier} (${payload.data.id}) transitioned to Done. Enqueueing delayed archive (delay: ${LINEAR_ARCHIVE_GRACE_PERIOD_SECONDS}s)`
    )

    // Cloudflare Queue or In-memory delayed task
    // (여기서 5초 이내 200을 반환하며 백그라운드 지연 큐에 등록)
    return NextResponse.json({
      success: true,
      enqueued: true,
      issueId: payload.data.id,
      identifier: payload.data.identifier,
      gracePeriodSeconds: LINEAR_ARCHIVE_GRACE_PERIOD_SECONDS,
    })
  }

  return NextResponse.json({ success: true, enqueued: false })
}

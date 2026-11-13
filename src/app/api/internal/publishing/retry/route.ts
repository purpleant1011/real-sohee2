import 'server-only'

import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { executeLivePublishRetry } from '@/features/publishing/actions/live-publish'
import { prepareInstagramProviderRejectedRetry } from '@/features/publishing/instagram-retry-preparation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const inputSchema = z.object({
  workspaceId: z.string().uuid(),
  actorUserId: z.string().uuid(),
  failedAttemptId: z.string().uuid(),
}).strict()

function authorized(request: Request): boolean {
  const supplied = request.headers.get('authorization')
  if (!supplied?.startsWith('Bearer ')) return false
  const candidate = supplied.slice(7)
  const left = Buffer.from(candidate)
  const rawSecretMatches = [process.env.INTERNAL_PUBLISH_RETRY_SECRET, process.env.CRON_SECRET]
    .filter((expected): expected is string => typeof expected === 'string' && expected.length >= 32)
    .some((expected) => {
      const right = Buffer.from(expected)
      return left.length === right.length && timingSafeEqual(left, right)
    })
  if (rawSecretMatches) return true

  const expectedHash = process.env.INTERNAL_PUBLISH_RETRY_SECRET_SHA256
  if (!expectedHash || !/^[a-f0-9]{64}$/u.test(expectedHash)) return false
  const candidateHash = createHash('sha256').update(candidate).digest()
  return timingSafeEqual(candidateHash, Buffer.from(expectedHash, 'hex'))
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  const input = inputSchema.safeParse(body)
  if (!input.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })

  try {
    await prepareInstagramProviderRejectedRetry({
      workspaceId: input.data.workspaceId,
      failedAttemptId: input.data.failedAttemptId,
    })
  } catch {
    return NextResponse.json({ error: 'retry_media_not_ready' }, { status: 409 })
  }

  const result = await executeLivePublishRetry(input.data)
  if (!result.data) return NextResponse.json({ error: 'retry_failed' }, { status: 503 })
  return NextResponse.json(result.data)
}

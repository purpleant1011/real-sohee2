import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { DEFAULT_DATASET_MODE } from '@/lib/dataset/dataset-guard'
import { BookingConfigurationError, configureBookingDestination, toConversionConfiguration } from './booking-configuration'
import { createBookingConfigurationRepository } from './booking-configuration-repository'
import { DestinationInputError, resolveConversionDestination, validateCampaignTag, type ConversionConfiguration } from './destination'

const querySchema = z.object({ campaignTag: z.string().max(80).optional() }).strict()
const commandSchema = z.object({
  bookingUrl: z.string().trim().min(1).max(2048).nullable(),
  bookingExpiresAt: z.iso.datetime({ offset: true }).nullable().optional().default(null),
  confirmed: z.literal(true), commandId: z.string().uuid(),
  expectedRevision: z.number().int().min(0).max(2_147_483_646),
}).strict()

export async function handleBookingDestination(request: Request): Promise<NextResponse> {
  if (request.method !== 'GET' && request.method !== 'POST') return NextResponse.json({ error: '지원하지 않는 요청이에요.' }, { status: 405 })
  const auth = await authorizeQuickRequest(request.headers.get('x-workspace-id'), { requireRole: 'manager' })
  if (isResponse(auth)) return auth
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!query.success) return NextResponse.json({ error: '캠페인 구분값을 확인해 주세요.' }, { status: 422 })
  try {
    validateCampaignTag(query.data.campaignTag)
    const repository = createBookingConfigurationRepository(auth.admin)
    const now = new Date()
    let configuration: ConversionConfiguration | null
    if (request.method === 'POST') {
      const body = commandSchema.safeParse(await request.json().catch(() => null))
      if (!body.success) return NextResponse.json({ error: '예약 주소와 확인 항목을 다시 확인해 주세요.' }, { status: 422 })
      configuration = await configureBookingDestination({
        ...body.data, workspaceId: auth.workspaceId, actorId: auth.userId, datasetMode: DEFAULT_DATASET_MODE,
      }, repository, now)
    } else {
      const row = await repository.latest(auth.workspaceId, DEFAULT_DATASET_MODE)
      configuration = row ? toConversionConfiguration(row) : null
    }
    const destination = resolveConversionDestination(configuration, {
      workspaceId: auth.workspaceId, datasetMode: DEFAULT_DATASET_MODE,
      publicOrigin: 'https://example.com', campaignTag: query.data.campaignTag, now,
    })
    return NextResponse.json({ configuration, destination, observedAt: now.toISOString() }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    if (error instanceof BookingConfigurationError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    if (error instanceof DestinationInputError && error.code !== 'WORKSPACE_MISMATCH' && error.code !== 'INVALID_PUBLIC_ORIGIN') return NextResponse.json({ error: error.message, code: error.code }, { status: 422 })
    return NextResponse.json({ error: '예약 주소를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.' }, { status: 503 })
  }
}

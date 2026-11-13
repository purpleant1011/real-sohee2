export const dynamic = 'force-dynamic';
import type { DataDeletionProvider, DataDeletionRequestStatus } from '@/features/data-deletion/repository'

type RouteContext = Readonly<{ params: Promise<{ channel: string }> }>
type Dependencies = Readonly<{
  findStatus(input: {
    confirmationCode: string
    provider: DataDeletionProvider
  }): Promise<DataDeletionRequestStatus | null>
}>

function parseProvider(value: string): DataDeletionProvider | null {
  return value === 'instagram' || value === 'threads' ? value : null
}

export function createProviderDeletionStatusGetHandler(dependencies: Dependencies) {
  return async function get(request: Request, context: RouteContext) {
    const provider = parseProvider((await context.params).channel)
    if (!provider) return new Response('Not Found', { status: 404 })
    const confirmationCode = new URL(request.url).searchParams.get('code') ?? ''
    try {
      const status = await dependencies.findStatus({ confirmationCode, provider })
      if (!status) return new Response('Not Found', { status: 404 })
      return Response.json({
        status: status.status,
        confirmation_code: confirmationCode,
        requested_at: status.requestedAt,
        updated_at: status.updatedAt,
        completed_at: status.completedAt,
      }, { headers: { 'cache-control': 'no-store, max-age=0' } })
    } catch {
      return new Response('Unavailable', { status: 503 })
    }
  }
}

const production = createProviderDeletionStatusGetHandler({
  async findStatus(input) {
    const { getDataDeletionRequestStatus } = await import('@/features/data-deletion/repository')
    return getDataDeletionRequestStatus(input)
  },
})

export const GET = production

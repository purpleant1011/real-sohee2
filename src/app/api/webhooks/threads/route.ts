export const dynamic = 'force-dynamic';
import { createMetaWebhookEventStore } from '@/features/meta-webhooks/event-store'
import { handleMetaWebhook } from '@/features/meta-webhooks/handler'

export const runtime = 'nodejs'

async function handle(request: Request) {
  const eventStore = await createMetaWebhookEventStore()
  return handleMetaWebhook(request, {
    provider: 'threads',
    verifyToken: process.env.THREADS_WEBHOOK_VERIFY_TOKEN,
    appSecret: process.env.THREADS_APP_SECRET,
    eventStore,
  })
}

export const GET = handle
export const POST = handle

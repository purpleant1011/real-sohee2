export const dynamic = 'force-dynamic';
import { handleInstagramWebhook } from '@/features/instagram-webhooks/handler'
import { createMetaWebhookEventStore } from '@/features/meta-webhooks/event-store'

export const runtime = 'nodejs'

async function handle(request: Request) {
  const eventStore = await createMetaWebhookEventStore()
  return handleInstagramWebhook(request, {
    verifyToken: process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN,
    appSecret: process.env.INSTAGRAM_APP_SECRET,
    eventStore,
  })
}

export const GET = handle
export const POST = handle

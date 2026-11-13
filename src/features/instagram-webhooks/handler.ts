import { handleMetaWebhook, type MetaWebhookOptions } from '@/features/meta-webhooks/handler'

type InstagramOptions = Omit<MetaWebhookOptions, 'provider'>

export function handleInstagramWebhook(request: Request, options: InstagramOptions) {
  return handleMetaWebhook(request, { ...options, provider: 'instagram' })
}

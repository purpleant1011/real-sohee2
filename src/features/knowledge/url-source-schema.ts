import { z } from 'zod'
import { supportedChannels, type SupportedChannel } from '@/features/channels/channel-capabilities'

export const urlCollectionStates = [
  'complete',
  'partial',
  'connection_required',
  'file_required',
  'access_limited',
  'refresh_required',
] as const

export type UrlCollectionState = (typeof urlCollectionStates)[number]
export type UrlSourceOwnership = 'owned' | 'reference'

const urlSchema = z.string().url().max(2_048).refine((value) => {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:') return false
    if (parsed.username || parsed.password) return false
    if (parsed.port && parsed.port !== '443') return false
    const host = parsed.hostname.toLowerCase()
    if (
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) ||
      /^\[?[0-9a-fA-F:]+\]?$/.test(host) ||
      host === 'localhost' ||
      host.endsWith('.localhost')
    ) {
      return false
    }
    return true
  } catch {
    return false
  }
}, '유효하고 안전한 HTTPS 주소만 등록할 수 있습니다.')

function validChannelUrl(channel: SupportedChannel, value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase()
    switch (channel) {
      case 'instagram':
        return host === 'instagram.com' || host.endsWith('.instagram.com')
      case 'threads':
        return (
          host === 'threads.net' ||
          host.endsWith('.threads.net') ||
          host === 'threads.com' ||
          host.endsWith('.threads.com')
        )
      case 'naver_blog':
        return host === 'blog.naver.com' || host.endsWith('.blog.naver.com')
      case 'naver_place':
        return host === 'map.naver.com' || host === 'naver.me'
      case 'daangn_business':
        return host === 'daangn.com' || host.endsWith('.daangn.com')
    }
  } catch {
    return false
  }
}

function initialCollectionState(channel: SupportedChannel, ownership: UrlSourceOwnership): UrlCollectionState {
  if (ownership === 'owned' && (channel === 'naver_place' || channel === 'daangn_business')) {
    return 'connection_required'
  }
  return 'refresh_required'
}

const baseUrlSourceSchema = z
  .object({
    workspaceId: z.string().uuid(),
    channel: z.enum(supportedChannels),
    ownership: z.enum(['owned', 'reference']),
    url: urlSchema,
    requestedScope: z.enum(['profile', 'posts', 'business_facts']).default('business_facts'),
    collectionState: z.enum(urlCollectionStates).optional(),
    allowedUse: z.enum(['business_facts', 'pattern_only']).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!validChannelUrl(value.channel, value.url)) {
      context.addIssue({
        code: 'custom',
        path: ['url'],
        message: '선택한 채널과 일치하는 주소를 입력해 주세요.',
      })
    }
    if (value.ownership === 'reference' && value.allowedUse !== undefined && value.allowedUse !== 'pattern_only') {
      context.addIssue({
        code: 'custom',
        path: ['allowedUse'],
        message: '참고 계정은 패턴 분석에만 사용할 수 있습니다.',
      })
    }
  })

export const urlSourceInputSchema = baseUrlSourceSchema.transform((value) => ({
  ...value,
  allowedUse: value.ownership === 'reference' ? 'pattern_only' as const : 'business_facts' as const,
  collectionState: value.collectionState ?? initialCollectionState(value.channel, value.ownership),
}))

export const ownedUrlSourceSchema = baseUrlSourceSchema
  .safeExtend({ ownership: z.literal('owned') })
  .transform((value) => ({
    ...value,
    allowedUse: 'business_facts' as const,
    collectionState: value.collectionState ?? initialCollectionState(value.channel, 'owned'),
  }))

export const referenceUrlSourceSchema = baseUrlSourceSchema
  .safeExtend({ ownership: z.literal('reference'), allowedUse: z.literal('pattern_only').optional() })
  .transform((value) => ({
    ...value,
    allowedUse: 'pattern_only' as const,
    collectionState: value.collectionState ?? initialCollectionState(value.channel, 'reference'),
  }))

export type UrlSourceInput = z.infer<typeof urlSourceInputSchema>

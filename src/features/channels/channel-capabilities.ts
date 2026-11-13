export const supportedChannels = [
  'instagram',
  'threads',
  'naver_blog',
  'naver_place',
  'daangn_business',
] as const

export type SupportedChannel = (typeof supportedChannels)[number]

export type ChannelCapability = Readonly<{
  supportsOrderedMedia: boolean
  supportsTextOnly: boolean
  requiresManualPublishPackage: boolean
  maxMediaCount: number
}>

export const channelCapabilities: Readonly<Record<SupportedChannel, ChannelCapability>> = {
  instagram: {
    supportsOrderedMedia: true,
    supportsTextOnly: false,
    requiresManualPublishPackage: false,
    maxMediaCount: 10,
  },
  threads: {
    supportsOrderedMedia: true,
    supportsTextOnly: true,
    requiresManualPublishPackage: false,
    maxMediaCount: 10,
  },
  naver_blog: {
    supportsOrderedMedia: true,
    supportsTextOnly: false,
    requiresManualPublishPackage: true,
    maxMediaCount: 10,
  },
  naver_place: {
    supportsOrderedMedia: true,
    supportsTextOnly: false,
    requiresManualPublishPackage: true,
    maxMediaCount: 10,
  },
  daangn_business: {
    supportsOrderedMedia: true,
    supportsTextOnly: false,
    requiresManualPublishPackage: true,
    maxMediaCount: 10,
  },
}

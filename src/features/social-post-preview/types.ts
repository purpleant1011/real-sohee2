export type SocialPostPreviewData = Readonly<{
  versionId: string
  channel: 'instagram' | 'threads'
  accountLabel: string
  caption: string
  hashtags: readonly string[]
  media: readonly Readonly<{
    id: string
    position: number
    altText: string
    src: string
  }>[]
}>

export type SocialPostPreviewMap = Readonly<Record<string, SocialPostPreviewData>>

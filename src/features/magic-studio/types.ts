export interface MagicStudioResult {
  id: string
  originalFileName: string
  enhancedImageUrl: string
  instagramCaption: string
  threadsText: string
  shortformScript: {
    durationSec: number
    hook: string
    bodyScenes: string[]
    cta: string
  }
  blogPost: {
    title: string
    body: string
    subheadings: string[]
  }
  hashtags: string[]
  createdAt: string
}

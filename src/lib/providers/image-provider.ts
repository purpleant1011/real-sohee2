export type ImageGenerationInput = Readonly<{
  prompt: string
  size?: '1024x1024' | '1024x1536' | '1536x1024'
  /** 사장님이 승인한 스타일 참고 사진. 있으면 참고 이미지를 붙여 생성하고, 실패하면 글만으로 만든다. */
  references?: ReadonlyArray<Readonly<{ bytes: Uint8Array; mimeType: string }>>
}>

export type ImageGenerationResult = Readonly<{
  bytes: Uint8Array
  mimeType: 'image/png'
  requestId: string | null
  usage?: UsageEventInput | null
}>

export interface ImageProvider {
  generate(input: ImageGenerationInput): Promise<ImageGenerationResult>
}
import type { UsageEventInput } from '@/features/credits/usage-event'

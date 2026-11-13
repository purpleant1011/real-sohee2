import type { z } from 'zod'
import type {
  revisionInputSchema,
  revisionResultSchema,
} from '@/features/content/version-schema'

export type ProviderMode = 'mock' | 'openai'
export type RevisionInput = z.infer<typeof revisionInputSchema>
export type RevisionResult = z.infer<typeof revisionResultSchema>

export interface RevisionProvider {
  readonly mode: ProviderMode
  revise(input: RevisionInput): Promise<RevisionResult>
}

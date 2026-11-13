import { z } from 'zod'

/** References identify evidence retained by the owner; never store a customer's identity here. */
export const uploadRightsSchema = z.object({
  copyright: z.enum(['owned', 'licensed', 'unknown']),
  commercialUse: z.boolean(),
  identifiablePeople: z.enum(['none', 'consented', 'unknown']),
  consentReference: z.string().trim().min(1).max(200).nullable(),
})
export type UploadRights = z.infer<typeof uploadRightsSchema>

export function evaluateUploadRights(input: unknown): {
  rightsStatus: 'pending' | 'confirmed'; publishEligible: boolean
} {
  const parsed = uploadRightsSchema.safeParse(input)
  const rights = parsed.success ? parsed.data : null
  const publishEligible = Boolean(rights && rights.copyright !== 'unknown' && rights.commercialUse
    && (rights.identifiablePeople === 'none'
      || (rights.identifiablePeople === 'consented' && rights.consentReference)))
  return { rightsStatus: publishEligible ? 'confirmed' : 'pending', publishEligible }
}

export function canPublishUploadedMedia(asset: {
  workspace_id: string; provenance_kind: string; lifecycle_status: string
  rights_status: string; publish_eligibility: boolean; generation_metadata: Record<string, unknown> | null
}, workspaceId: string): boolean {
  return asset.workspace_id === workspaceId && asset.provenance_kind === 'USER_UPLOAD'
    && asset.lifecycle_status === 'READY' && asset.rights_status === 'confirmed'
    && asset.publish_eligibility === true && !asset.generation_metadata?.rightsWithdrawnAt
    && evaluateUploadRights(asset.generation_metadata?.uploadRights).publishEligible
}

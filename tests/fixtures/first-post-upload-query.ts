// Synthetic uploaded photo query for legacy proposal unit fixtures; not real media/Auth evidence.
export const PROPOSAL_UPLOAD_ID = 'a1458000-0000-4000-8000-000000000001'
export function proposalUploadQuery(workspaceId: string, options: {
  empty?: boolean
  copyright?: string
  identifiablePeople?: string
} = {}) {
  const asset = {
    id: PROPOSAL_UPLOAD_ID, workspace_id: workspaceId, provenance_kind: 'USER_UPLOAD',
    lifecycle_status: 'READY', rights_status: 'confirmed', publish_eligibility: true,
    generation_metadata: { uploadRights: {
      copyright: options.copyright ?? 'owned', commercialUse: true,
      identifiablePeople: options.identifiablePeople ?? 'none', consentReference: null,
    } },
  }
  const query: any = {
    select: () => query, eq: () => query, in: () => query, order: () => query,
    limit: async () => ({ data: options.empty ? [] : [asset], error: null }),
    maybeSingle: async () => ({ data: options.empty ? null : asset, error: null }),
  }
  return query
}

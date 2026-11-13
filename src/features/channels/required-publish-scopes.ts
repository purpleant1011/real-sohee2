export const REQUIRED_PUBLISH_SCOPES = {
  instagram: [
    'instagram_business_basic',
    'instagram_business_content_publish',
  ],
  threads: [
    'threads_basic',
    'threads_content_publish',
  ],
} as const

export type PublishScopeChannel = keyof typeof REQUIRED_PUBLISH_SCOPES

/**
 * Returns any publish scopes missing from grantedScopes for the channel.
 * Returns an empty array if all required scopes are granted, or if the channel has no required publish scopes.
 */
export function missingPublishScopes(
  channel: 'instagram' | 'threads' | string,
  grantedScopes: readonly string[] | null | undefined,
): readonly string[] {
  if (channel !== 'instagram' && channel !== 'threads') {
    return []
  }

  const required = REQUIRED_PUBLISH_SCOPES[channel]
  if (!grantedScopes || grantedScopes.length === 0) {
    return required
  }

  const grantedSet = new Set(grantedScopes)
  return required.filter((scope) => !grantedSet.has(scope))
}

import {
  publishProviderInputSchema,
  type PublishProvider,
  type PublishProviderErrorCode,
  type PublishProviderInput,
  type PublishProviderResult,
} from './publish-provider'

function stableHash(value: string, seed: number): string {
  let hash = seed

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}

function mockPostId(input: PublishProviderInput): string {
  const context = [
    input.workspaceId,
    input.scheduleId,
    input.versionId,
    input.channelConnectionId,
    input.channel,
    input.idempotencyKey,
    input.contentFingerprint,
    input.simulation,
  ].join('\u001f')

  return `mock-post-${stableHash(context, 2_166_136_261)}${stableHash(
    context,
    2_244_682_033,
  )}`
}

function successResult(input: PublishProviderInput): PublishProviderResult {
  return Object.freeze({
    ok: true,
    providerPostId: mockPostId(input),
    errorCode: null,
  })
}

function failureResult(errorCode: PublishProviderErrorCode): PublishProviderResult {
  return Object.freeze({
    ok: false,
    providerPostId: null,
    errorCode,
  })
}

export const mockPublishProvider: PublishProvider = {
  mode: 'mock',
  async publish(rawInput: PublishProviderInput): Promise<PublishProviderResult> {
    const input = publishProviderInputSchema.parse(rawInput)

    switch (input.simulation) {
      case 'success':
        return successResult(input)
      case 'temporary_network':
        return failureResult('TEMPORARY_NETWORK')
      case 'rate_limited':
        return failureResult('RATE_LIMITED')
      case 'token_expired':
        return failureResult('TOKEN_EXPIRED')
      case 'reapproval_required':
        return failureResult('APPROVAL_STALE')
      case 'provider_rejected':
        return failureResult('PROVIDER_REJECTED')
    }
  },
}

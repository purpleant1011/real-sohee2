import 'server-only'

import { Buffer } from 'node:buffer'
import type OpenAI from 'openai'
import type {
  ImageGenerationInput,
  ImageGenerationResult,
  ImageProvider,
} from './image-provider'
import { mapImageUsage } from '@/features/credits/usage-event'

const safeMessage = 'AI 이미지를 안전하게 처리하지 못했습니다.'
const maximumBytes = 10 * 1024 * 1024
const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

type OpenAIImageProviderDependencies = Readonly<{
  decodeBase64(value: string): Uint8Array
}>

const defaultDependencies: OpenAIImageProviderDependencies = Object.freeze({
  decodeBase64(value) {
    const buffer = Buffer.from(value, 'base64')
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  },
})

export class OpenAIImageProviderError extends Error {
  readonly code: string

  constructor(message = safeMessage, code = 'IMAGE_PROVIDER_UNAVAILABLE') {
    super(message)
    this.name = 'OpenAIImageProviderError'
    this.code = code
  }
}

function providerField(error: unknown, field: 'status' | 'code' | 'type' | 'param' | 'request_id') {
  if (!error || typeof error !== 'object' || !(field in error)) return null
  const value = error[field as keyof typeof error]
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

function safeProviderCode(error: unknown, hasReferences = false) {
  const status = providerField(error, 'status')
  const code = providerField(error, 'code')
  const type = providerField(error, 'type')
  const param = providerField(error, 'param')
  if (status === 401 || code === 'invalid_api_key') return 'IMAGE_AUTH_REQUIRED'
  if (code === 'insufficient_quota' || type === 'insufficient_quota') return 'IMAGE_QUOTA_EXHAUSTED'
  if (status === 429 || code === 'rate_limit_exceeded') return 'IMAGE_RATE_LIMITED'
  if (status === 403 || code === 'model_not_found') return 'IMAGE_MODEL_UNAVAILABLE'
  if (code === 'content_policy_violation') return 'IMAGE_POLICY_REJECTED'
  if (status === 400 && param === 'prompt') return 'IMAGE_PROMPT_INVALID'
  if (param === 'image' || hasReferences) return 'IMAGE_REFERENCE_UNAVAILABLE'
  return 'IMAGE_PROVIDER_UNAVAILABLE'
}

function decodedBase64ByteLength(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}

function decodeVerifiedPng(
  value: unknown,
  dependencies: OpenAIImageProviderDependencies,
): Uint8Array {
  if (typeof value !== 'string' || value.length === 0 || !base64Pattern.test(value)) {
    throw new OpenAIImageProviderError()
  }

  const expectedBytes = decodedBase64ByteLength(value)
  if (expectedBytes < pngSignature.byteLength || expectedBytes > maximumBytes) {
    throw new OpenAIImageProviderError()
  }

  const decoded = dependencies.decodeBase64(value)
  if (decoded.byteLength !== expectedBytes) {
    throw new OpenAIImageProviderError()
  }

  for (let index = 0; index < pngSignature.byteLength; index += 1) {
    if (decoded[index] !== pngSignature[index]) throw new OpenAIImageProviderError()
  }

  return decoded
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

export function createOpenAIImageProvider(
  client: Pick<OpenAI, 'images'>,
  model: string,
  dependencies: OpenAIImageProviderDependencies = defaultDependencies,
): ImageProvider {
  return {
    async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
      try {
        const size = input.size ?? '1024x1024'
        const plain = () => client.images.generate({
          model,
          prompt: input.prompt,
          size,
          quality: 'medium',
          output_format: 'png',
        })
        const hasReferences = Boolean(input.references && input.references.length > 0)
        let response
        if (hasReferences) {
          const references = input.references ?? []
          for (const reference of references) {
            if (!reference.bytes || reference.bytes.byteLength === 0) {
              throw new OpenAIImageProviderError(safeMessage, 'IMAGE_REFERENCE_UNAVAILABLE')
            }
          }
          const images = references.map((reference, index) => new File(
            [copyBytes(reference.bytes)],
            `style-reference-${index + 1}.${reference.mimeType === 'image/jpeg' ? 'jpg' : reference.mimeType === 'image/webp' ? 'webp' : 'png'}`,
            { type: reference.mimeType },
          ))
          response = await client.images.edit({
            model,
            image: images,
            prompt: input.prompt,
            size,
            quality: 'medium',
            output_format: 'png',
          })
        } else {
          response = await plain()
        }
        const bytes = decodeVerifiedPng(response.data?.[0]?.b64_json, dependencies)
        const requestId =
          typeof response._request_id === 'string' && response._request_id.length > 0
            ? response._request_id
            : null
        let usage: ImageGenerationResult['usage'] = null
        try {
          usage = mapImageUsage(requestId, model, response.usage)
        } catch {
          // The verified image remains valid. The job runner records an explicit
          // estimate when the provider omits usage counters.
        }
        return {
          bytes,
          mimeType: 'image/png',
          requestId,
          usage,
        }
      } catch (error) {
        if (error instanceof OpenAIImageProviderError) {
          throw error
        }
        const hasReferences = Boolean(input.references && input.references.length > 0)
        const safeCode = safeProviderCode(error, hasReferences)
        console.error('[sohee:openai-image-provider-failed]', {
          safeCode,
          status: providerField(error, 'status'),
          providerCode: providerField(error, 'code'),
          providerType: providerField(error, 'type'),
          parameter: providerField(error, 'param'),
          requestId: providerField(error, 'request_id'),
        })
        throw new OpenAIImageProviderError(safeMessage, safeCode)
      }
    },
  }
}

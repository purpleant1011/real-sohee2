import { createHash } from 'node:crypto'
import { validateBookingUrl, type ConversionConfiguration, type ConversionDatasetMode } from './destination'

export type BookingConfigurationVersion = {
  workspaceId: string
  datasetMode: ConversionDatasetMode
  revision: number
  commandId: string
  commandDigest: string
  bookingUrl: string | null
  bookingExpiresAt: string | null
  confirmedAt: string
  confirmedBy: string | null
}
export interface BookingConfigurationRepository {
  findCommand(workspaceId: string, mode: ConversionDatasetMode, commandId: string): Promise<BookingConfigurationVersion | null>
  latest(workspaceId: string, mode: ConversionDatasetMode): Promise<BookingConfigurationVersion | null>
  append(row: BookingConfigurationVersion): Promise<'INSERTED' | 'CONFLICT'>
}
export type ConfigureBookingInput = {
  workspaceId: string
  actorId: string
  datasetMode: ConversionDatasetMode
  commandId: string
  expectedRevision: number
  confirmed: boolean
  bookingUrl: string | null
  bookingExpiresAt: string | null
}
export class BookingConfigurationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message) }
}

export function toConversionConfiguration(row: BookingConfigurationVersion): ConversionConfiguration {
  return {
    workspaceId: row.workspaceId, datasetMode: row.datasetMode, revision: row.revision,
    bookingUrl: row.bookingUrl, bookingExpiresAt: row.bookingExpiresAt,
    confirmedAt: row.confirmedBy ? row.confirmedAt : null,
    // Inquiry publishing remains unsupported until its consent/spam/storage flow is implemented.
    landing: { slug: '', enabled: false, privacyNoticeVersion: '', publicDisclosure: '' },
  }
}

export async function configureBookingDestination(input: ConfigureBookingInput, repository: BookingConfigurationRepository, now = new Date()): Promise<ConversionConfiguration> {
  if (input.confirmed !== true || !input.actorId || !input.workspaceId || !input.commandId || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0 || !Number.isFinite(now.getTime())) {
    throw new BookingConfigurationError(422, 'CONFIRMATION_REQUIRED', '공유할 예약 주소를 직접 확인해 주세요.')
  }
  let bookingUrl: string | null
  try { bookingUrl = input.bookingUrl === null ? null : validateBookingUrl(input.bookingUrl) } catch {
    throw new BookingConfigurationError(422, 'INVALID_BOOKING_URL', '고객에게 공유할 수 있는 예약 주소를 입력해 주세요.')
  }
  let expiresAt: string | null = null
  if (input.bookingExpiresAt !== null) {
    const expires = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.bookingExpiresAt) ? Date.parse(input.bookingExpiresAt) : NaN
    if (!Number.isFinite(expires) || expires <= now.getTime()) throw new BookingConfigurationError(422, 'EXPIRED_BOOKING_URL', '예약 주소의 사용 기간을 확인해 주세요.')
    expiresAt = new Date(expires).toISOString()
  }
  const digest = createHash('sha256').update(JSON.stringify([
    input.workspaceId, input.actorId, input.datasetMode, input.expectedRevision, bookingUrl, expiresAt,
  ])).digest('hex')
  const validateObserved = (row: BookingConfigurationVersion): ConversionConfiguration => {
    if (row.workspaceId !== input.workspaceId || row.datasetMode !== input.datasetMode || row.commandId !== input.commandId) {
      throw new BookingConfigurationError(503, 'CONFIGURATION_READBACK_FAILED', '예약 주소 저장 기록을 확인하지 못했어요.')
    }
    if (row.commandDigest !== digest) throw new BookingConfigurationError(409, 'IDEMPOTENCY_CONFLICT', '다른 설정에 사용한 요청이에요. 내용을 다시 확인해 주세요.')
    if (row.revision !== input.expectedRevision + 1 || row.bookingUrl !== bookingUrl || row.bookingExpiresAt !== expiresAt || row.confirmedBy !== input.actorId || !Number.isFinite(Date.parse(row.confirmedAt))) {
      throw new BookingConfigurationError(503, 'CONFIGURATION_READBACK_FAILED', '예약 주소 저장 기록을 확인하지 못했어요.')
    }
    return toConversionConfiguration(row)
  }
  const replay = await repository.findCommand(input.workspaceId, input.datasetMode, input.commandId)
  if (replay) return validateObserved(replay)
  const current = await repository.latest(input.workspaceId, input.datasetMode)
  if (current && (current.workspaceId !== input.workspaceId || current.datasetMode !== input.datasetMode)) throw new BookingConfigurationError(503, 'CONFIGURATION_READ_FAILED', '예약 주소를 확인하지 못했어요.')
  if ((current?.revision ?? 0) !== input.expectedRevision) throw new BookingConfigurationError(409, 'STALE_CONFIGURATION', '예약 주소가 변경되었어요. 최신 내용을 다시 확인해 주세요.')
  const result = await repository.append({
    workspaceId: input.workspaceId, datasetMode: input.datasetMode, revision: input.expectedRevision + 1,
    commandId: input.commandId, commandDigest: digest, bookingUrl, bookingExpiresAt: expiresAt,
    confirmedAt: now.toISOString(), confirmedBy: input.actorId,
  })
  const observed = await repository.findCommand(input.workspaceId, input.datasetMode, input.commandId)
  if (observed) return validateObserved(observed)
  if (result === 'CONFLICT') throw new BookingConfigurationError(409, 'STALE_CONFIGURATION', '다른 설정이 먼저 저장되었어요. 최신 내용을 다시 확인해 주세요.')
  throw new BookingConfigurationError(503, 'CONFIGURATION_READBACK_FAILED', '예약 주소 저장 기록을 확인하지 못했어요.')
}

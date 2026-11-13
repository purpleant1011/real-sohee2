import { CONNECTOR_CATALOG, type ConnectorId } from './catalog'

export interface DisconnectReceipt {
  ok: true
  connectorId: ConnectorId
  pendingDeletion: boolean
  consentGeneration: number
}

const KNOWN_CONNECTOR_IDS: ReadonlySet<string> = new Set(CONNECTOR_CATALOG.map((c) => c.id))

export function isKnownConnectorId(value: unknown): value is ConnectorId {
  return typeof value === 'string' && KNOWN_CONNECTOR_IDS.has(value)
}

/**
 * DELETE 200 영수증 엄격 검증. alias/특례 없이 요청한 커넥터 ID와 정확히 같아야 한다.
 */
export function isValidDisconnectReceipt(receipt: unknown, expectedId: ConnectorId): receipt is DisconnectReceipt {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false
  const r = receipt as Record<string, unknown>
  return (
    r.ok === true &&
    isKnownConnectorId(expectedId) &&
    isKnownConnectorId(r.connectorId) &&
    r.connectorId === expectedId &&
    typeof r.pendingDeletion === 'boolean' &&
    typeof r.consentGeneration === 'number' &&
    Number.isSafeInteger(r.consentGeneration) &&
    r.consentGeneration > 0
  )
}

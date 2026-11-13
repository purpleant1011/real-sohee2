import 'server-only'

export type SLOHealthStatus = 'HEALTHY' | 'DEGRADED' | 'STALE' | 'BLOCKED' | 'UNKNOWN' | 'NOT_OBSERVED'

export interface SignalMetricInput {
  signalName: string
  lastObservedAt?: string | null
  thresholdSeconds: number
  isConnected?: boolean
  details?: Record<string, unknown>
}

export interface SignalEvaluationDetail {
  signalName: string
  status: SLOHealthStatus
  lagSeconds: number | null
  thresholdSeconds: number
  lastObservedAt?: string | null
  message: string
}

export interface FreshnessEvaluationResult {
  overallHealth: SLOHealthStatus
  evaluatedAt: string
  degradedSignals: string[]
  details: SignalEvaluationDetail[]
}

export class FreshnessSLOEngine {
  /**
   * Evaluates freshness SLO across all vital inbound/channel/audit signals.
   */
  public evaluateFreshness(signals: SignalMetricInput[]): FreshnessEvaluationResult {
    const now = Date.now()
    const degradedSignals: string[] = []
    const details: SignalEvaluationDetail[] = []

    let allNotObserved = true
    let hasDegraded = false
    let hasStale = false

    for (const sig of signals) {
      if (sig.isConnected === false) {
        hasDegraded = true
        degradedSignals.push(sig.signalName)
        details.push({
          signalName: sig.signalName,
          status: 'BLOCKED',
          lagSeconds: null,
          thresholdSeconds: sig.thresholdSeconds,
          lastObservedAt: sig.lastObservedAt,
          message: `채널 연결이 끊어져 있습니다 (${sig.signalName})`,
        })
        allNotObserved = false
        continue
      }

      if (!sig.lastObservedAt) {
        details.push({
          signalName: sig.signalName,
          status: 'NOT_OBSERVED',
          lagSeconds: null,
          thresholdSeconds: sig.thresholdSeconds,
          lastObservedAt: null,
          message: `관찰된 이벤트 기록이 없습니다 (${sig.signalName})`,
        })
        continue
      }

      allNotObserved = false
      const observedTime = new Date(sig.lastObservedAt).getTime()
      const lagSeconds = Math.max(0, Math.floor((now - observedTime) / 1000))

      if (lagSeconds > sig.thresholdSeconds) {
        hasStale = true
        hasDegraded = true
        degradedSignals.push(sig.signalName)
        details.push({
          signalName: sig.signalName,
          status: 'STALE',
          lagSeconds,
          thresholdSeconds: sig.thresholdSeconds,
          lastObservedAt: sig.lastObservedAt,
          message: `이벤트 지연이 임계값(${sig.thresholdSeconds}초)을 초과했습니다 (현재 ${lagSeconds}초)`,
        })
      } else {
        details.push({
          signalName: sig.signalName,
          status: 'HEALTHY',
          lagSeconds,
          thresholdSeconds: sig.thresholdSeconds,
          lastObservedAt: sig.lastObservedAt,
          message: '정상 갱신 중',
        })
      }
    }

    let overallHealth: SLOHealthStatus = 'HEALTHY'
    if (allNotObserved && signals.length > 0) {
      overallHealth = 'NOT_OBSERVED'
    } else if (hasDegraded || hasStale) {
      overallHealth = 'DEGRADED'
    }

    return {
      overallHealth,
      evaluatedAt: new Date(now).toISOString(),
      degradedSignals,
      details,
    }
  }
}

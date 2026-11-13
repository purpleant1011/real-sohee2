/**
 * Sohee V0.8.8 Guardrail Engine
 * [ANI-195] Guardrails + Kill Switch — 서버 실행 전 안전정책 강제
 */

export interface GuardrailCheckRequest {
  workspaceId: string
  actionType: 'outbound_message' | 'publish_post' | 'paid_spend' | 'booking_modification'
  customerId?: string
  spendAmountWon?: number
  timestamp?: Date
}

export interface GuardrailCheckResult {
  allowed: boolean
  blockedReason?: string
  enforcementRule?: 'KILL_SWITCH' | 'QUIET_HOURS' | 'FREQUENCY_CAP' | 'BUDGET_CAP'
}

export interface GuardrailConfig {
  killSwitchEnabled: boolean
  quietHours: {
    enabled: boolean
    startHour: number // 21 (9 PM)
    endHour: number   // 8  (8:30 AM)
  }
  frequencyCap: {
    maxPerDay: number   // 1
    maxPerWeek: number  // 2
  }
  budgetCapWon: {
    dailyLimit: number  // 50,000 won
    monthlyLimit: number // 500,000 won
  }
}

const DEFAULT_CONFIG: GuardrailConfig = {
  killSwitchEnabled: false,
  quietHours: {
    enabled: true,
    startHour: 21,
    endHour: 9
  },
  frequencyCap: {
    maxPerDay: 1,
    maxPerWeek: 2
  },
  budgetCapWon: {
    dailyLimit: 50000,
    monthlyLimit: 500000
  }
}

export class GuardrailEngine {
  private config: GuardrailConfig
  private outboundLog: { customerId: string; date: Date }[] = []
  private dailySpendWon = 0

  constructor(customConfig?: Partial<GuardrailConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...customConfig }
  }

  setKillSwitch(enabled: boolean) {
    this.config.killSwitchEnabled = enabled
  }

  getKillSwitch(): boolean {
    return this.config.killSwitchEnabled
  }

  /**
   * Pre-execution safety gate check
   */
  evaluate(req: GuardrailCheckRequest): GuardrailCheckResult {
    const now = req.timestamp || new Date()

    // 1. Emergency Kill Switch check
    if (this.config.killSwitchEnabled) {
      return {
        allowed: false,
        blockedReason: '긴급 킬스위치(Kill Switch)가 활성화되어 모든 외부 액션이 차단되었습니다.',
        enforcementRule: 'KILL_SWITCH'
      }
    }

    // 2. Quiet Hours check for outbound communications
    if (req.actionType === 'outbound_message') {
      const currentHour = now.getHours()
      const isQuietHours = currentHour >= this.config.quietHours.startHour || currentHour < this.config.quietHours.endHour
      if (this.config.quietHours.enabled && isQuietHours) {
        return {
          allowed: false,
          blockedReason: `야간 방해금지 시간(${this.config.quietHours.startHour}시 ~ 익일 ${this.config.quietHours.endHour}시)에는 고객에게 메시지를 발송할 수 없습니다.`,
          enforcementRule: 'QUIET_HOURS'
        }
      }
    }

    // 3. Frequency Cap check
    if (req.actionType === 'outbound_message' && req.customerId) {
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

      const dailyCount = this.outboundLog.filter(
        l => l.customerId === req.customerId && l.date >= oneDayAgo
      ).length

      const weeklyCount = this.outboundLog.filter(
        l => l.customerId === req.customerId && l.date >= oneWeekAgo
      ).length

      if (dailyCount >= this.config.frequencyCap.maxPerDay) {
        return {
          allowed: false,
          blockedReason: `동일 고객 1일 최대 발송 제한(${this.config.frequencyCap.maxPerDay}회)을 초과했습니다.`,
          enforcementRule: 'FREQUENCY_CAP'
        }
      }

      if (weeklyCount >= this.config.frequencyCap.maxPerWeek) {
        return {
          allowed: false,
          blockedReason: `동일 고객 주간 최대 발송 제한(${this.config.frequencyCap.maxPerWeek}회)을 초과했습니다.`,
          enforcementRule: 'FREQUENCY_CAP'
        }
      }
    }

    // 4. Budget Cap check
    if (req.actionType === 'paid_spend' && req.spendAmountWon) {
      if (this.dailySpendWon + req.spendAmountWon > this.config.budgetCapWon.dailyLimit) {
        return {
          allowed: false,
          blockedReason: `일일 최대 지출 한도(${this.config.budgetCapWon.dailyLimit.toLocaleString()}원)를 초과합니다.`,
          enforcementRule: 'BUDGET_CAP'
        }
      }
    }

    return {
      allowed: true
    }
  }

  recordOutbound(customerId: string, date = new Date()) {
    this.outboundLog.push({ customerId, date })
  }

  recordSpend(amountWon: number) {
    this.dailySpendWon += amountWon
  }
}

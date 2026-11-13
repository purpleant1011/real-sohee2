'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { 
  PLAN_CONFIGS, 
  type CreditAccount, 
  type CreditOperationalMode 
} from '@/features/marketing-agent/engine/credit-economy'
import { useOptionalWorkspaceContext } from './use-workspace-context'
import { parseConversationWorkStatus } from '@/features/chat/conversation-work-status'

export interface ServerCreditState {
  workspaceId: string
  planId: string
  isPaidTier: boolean
  budgetAlertStage: string
  capacity: number
  balance: number
  available: number
  reserved: number
  spent: number
  usedCredits: number
  usagePercentage: number
  remainingPercentage: number
  energyBalance: number
  energyCapacity: number
  energySpent: number
  operationalMode: CreditOperationalMode
  planName: string
  refillAt: string
  burnGovernorActive: boolean
  isLoading: boolean
  hasError: boolean
  refreshCredits: () => void
  reserveCredit: (amount: number, missionId: string) => Promise<boolean>
  settleCredit: (reservationId: string, actualCost: number) => Promise<boolean>
  consumeCredits: (amount: number) => void
  rechargeCredits: (amount: number) => void
}

export function useCreditBalance(customWorkspaceId?: string, source: 'energy' | 'conversation' = 'energy') {
  const context = useOptionalWorkspaceContext()
  const currentWorkspaceId = (customWorkspaceId && customWorkspaceId !== 'ws-default')
    ? customWorkspaceId
    : (context?.workspaceId || '')
  const [, startTransition] = useTransition()
  
  const [account, setAccount] = useState<CreditAccount>(() => ({
    workspaceId: currentWorkspaceId,
    planId: 'FREE_TASTE' as any,
    weeklyCapacitySC: 0, // Fail-Closed: Start at 0 until confirmed from authoritative server ledger
    refillRateSCPerSecond: 0,
    balanceSC: 0, // Fail-Closed: Start at 0 until confirmed from authoritative server ledger
    reservedSC: 0,
    lastAccruedAt: Date.now(),
    status: 'ACTIVE'
  }))
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [budgetAlertStage, setBudgetAlertStage] = useState<string>('NORMAL')

  const fetchServerBalance = useCallback(async (wsId: string) => {
    if (!wsId || wsId === 'ws-default') {
      setIsLoading(false)
      setHasError(false)
      return
    }
    setIsLoading(true)
    setHasError(false)
    try {
      const url = source === 'conversation'
        ? `/api/workspaces/${wsId}/conversation-work-status`
        : `/api/workspaces/${wsId}/agent/energy?_t=${Date.now()}`
      const res = await fetch(url, { cache: 'no-store' })
      if (res.ok) {
        const payload = await res.json()
        const credit = source === 'conversation' ? parseConversationWorkStatus(payload.data).creditBalance : null
        const data = credit ? {
          balanceSC: credit.available + credit.reserved,
          reservedSC: credit.reserved,
          capacity: credit.weeklyLimit,
        } : payload
        if (data && typeof data.balanceSC === 'number') {
          startTransition(() => {
            setAccount({
              workspaceId: wsId,
              planId: data.planTier || 'FREE_TASTE',
              weeklyCapacitySC: typeof data.capacity === 'number' ? data.capacity : 0,
              refillRateSCPerSecond: 0,
              balanceSC: data.balanceSC,
              reservedSC: data.reservedSC || 0,
              lastAccruedAt: Date.now(),
              status: data.status || 'ACTIVE'
            })
            setBudgetAlertStage(data.budgetAlertStage || 'NORMAL')
          })
          setHasError(false)
          return
        }
      }
      // Fail-closed on bad response (ANI-722)
      setHasError(true)
      setAccount(prev => ({
        ...prev,
        weeklyCapacitySC: 0,
        balanceSC: 0,
        status: 'DEPLETED'
      }))
    } catch {
      // Fail-closed on network/server error (ANI-722)
      setHasError(true)
      setAccount(prev => ({
        ...prev,
        weeklyCapacitySC: 0,
        balanceSC: 0,
        status: 'DEPLETED'
      }))
    } finally {
      setIsLoading(false)
    }
  }, [source])

  useEffect(() => {
    let ignore = false
    const syncBalance = async () => {
      if (!ignore) {
        await fetchServerBalance(currentWorkspaceId)
      }
    }
    void syncBalance()
    return () => {
      ignore = true
    }
  }, [currentWorkspaceId, fetchServerBalance])

  const planConfig = PLAN_CONFIGS[account.planId] || {
    planId: account.planId,
    name: account.planId === 'FREE_TASTE' ? '실제 사업자 무료 맛보기' : '기본 마케팅 직원 (월 15만)',
    priceKRW: account.planId === 'FREE_TASTE' ? 0 : 150000,
    weeklyCapacitySC: account.weeklyCapacitySC,
    refillRateSCPerSecond: 0,
    maxAutonomousSCPerMission: 1500,
    maxAutonomousSCPerHour: 3000,
    maxExperimentSCPerDay: 2000,
    maxDiscoverySCPerWeek: 5000
  }
  const capacity = typeof account.weeklyCapacitySC === 'number' ? account.weeklyCapacitySC : 0
  const available = Math.max(0, account.balanceSC - account.reservedSC)
  const spent = Math.max(0, capacity - account.balanceSC)
  const usedCredits = spent
  const usagePercentage = capacity > 0 ? Math.min(100, Math.round((spent / capacity) * 100)) : 0
  const remainingPercentage = capacity > 0 ? Math.max(0, Math.round((available / capacity) * 100)) : 0

  // Fail-Closed Reservation (ANI-722): Never return true without server verification
  const reserveCredit = useCallback(async (amount: number, missionId: string): Promise<boolean> => {
    try {
      const energyAmount = Math.ceil(amount / 100) // 100 SC = 1 Energy
      const res = await fetch(`/api/workspaces/${currentWorkspaceId}/agent/energy/reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: energyAmount, missionId })
      })
      if (res.ok) {
        const data = await res.json()
        if (data?.success) {
          // Immediately refresh canonical state
          void fetchServerBalance(currentWorkspaceId)
          return true
        }
      }
    } catch {
      // Fail-closed
    }
    return false
  }, [currentWorkspaceId, fetchServerBalance])

  // Fail-Closed Settlement (ANI-722): Never claim success on network/server failure
  const settleCredit = useCallback(async (reservationId: string, actualCost: number): Promise<boolean> => {
    try {
      const energySpent = Math.ceil(actualCost / 100) // 100 SC = 1 Energy
      const res = await fetch(`/api/workspaces/${currentWorkspaceId}/agent/energy/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservationId, actualSpent: energySpent })
      })
      if (res.ok) {
        const data = await res.json()
        if (data?.success) {
          void fetchServerBalance(currentWorkspaceId)
          return true
        }
      }
    } catch {
      // Fail-closed
    }
    return false
  }, [currentWorkspaceId, fetchServerBalance])

  const consumeCredits = useCallback((_amount: number) => {
    // Client-side direct mutation prohibited; trigger canonical server sync
    void fetchServerBalance(currentWorkspaceId)
  }, [currentWorkspaceId, fetchServerBalance])

  const rechargeCredits = useCallback((_amount: number) => {
    // Client-side direct mutation prohibited; trigger canonical server sync
    void fetchServerBalance(currentWorkspaceId)
  }, [currentWorkspaceId, fetchServerBalance])

  const burnGovernorActive =
    budgetAlertStage !== 'NORMAL' ||
    account.status === 'CONSERVE' ||
    account.status === 'CRITICAL' ||
    account.status === 'DEPLETED'

  const refillAt =
    account.planId === 'FREE_TASTE'
      ? '추가 리필 없음 (유료 플랜 전환 필요)'
      : '매월 1일 00:00 (월간 갱신)'

  return {
    workspaceId: currentWorkspaceId,
    planId: account.planId,
    isPaidTier: account.planId !== 'FREE_TASTE',
    budgetAlertStage,
    capacity,
    balance: source === 'conversation' ? available : account.balanceSC,
    available,
    reserved: account.reservedSC,
    spent,
    usedCredits,
    usagePercentage,
    remainingPercentage,
    energyBalance: Math.round(account.balanceSC / 100),
    energyCapacity: Math.round(capacity / 100),
    energySpent: Math.round(spent / 100),
    status: account.status as CreditOperationalMode,
    planName: planConfig.name,
    refillAt,
    burnGovernorActive,
    isLoading,
    hasError,
    refreshCredits: () => fetchServerBalance(currentWorkspaceId),
    reserveCredit,
    settleCredit,
    consumeCredits,
    rechargeCredits
  }
}

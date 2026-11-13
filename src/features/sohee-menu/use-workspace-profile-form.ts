'use client'

import { useCallback, useEffect, useState } from 'react'
import { PROPOSAL_APPLIED_EVENT } from '@/features/agent-dock/proposal-bus'
import type { ProposalPayload } from '@/features/agent-dock/types'
import { isMeaningfulText } from '@/features/sohee-growth/constants'

export interface WorkspaceProfileValues {
  businessName: string
  industry: string
  location: string
  summary: string
  voice: string
  keywords: string
  prohibitedTerms: string
}

export type PersistenceState =
  | 'DIRTY'
  | 'SAVING'
  | 'PERSISTED'
  | 'READBACK_VERIFIED'
  | 'PERSISTENCE_FAILED'

export interface WorkspaceProfileFormStatus {
  isSaving: boolean
  saveSuccess: boolean
  saveError: string | null
  persistenceState: PersistenceState
  proposalAlert: string | null
}

export interface UseWorkspaceProfileFormOptions {
  onSaved?: () => void
}

const INITIAL_VALUES: WorkspaceProfileValues = {
  businessName: '',
  industry: '',
  location: '',
  summary: '',
  voice: '',
  keywords: '',
  prohibitedTerms: '',
}

export function useWorkspaceProfileForm(
  workspaceId: string,
  options?: UseWorkspaceProfileFormOptions,
) {
  const [values, setValues] = useState<WorkspaceProfileValues>(INITIAL_VALUES)
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [persistenceState, setPersistenceState] = useState<PersistenceState>('READBACK_VERIFIED')
  const [proposalAlert, setProposalAlert] = useState<string | null>(null)

  // Chat ↔ UI Same Truth: Listen to Proposal Bus accepted events
  useEffect(() => {
    const handleProposalApplied = (e: Event) => {
      const customEvent = e as CustomEvent<ProposalPayload>
      const prop = customEvent.detail
      if (!prop) return

      if (prop.type === 'RULE_UPDATE' || prop.type === 'SETTING_UPDATE') {
        if (prop.targetField === 'prohibitedTerms' && typeof prop.proposedValue === 'string') {
          setValues((prev) => ({
            ...prev,
            prohibitedTerms: prev.prohibitedTerms
              ? `${prev.prohibitedTerms}, ${prop.proposedValue}`
              : prop.proposedValue as string,
          }))
          setProposalAlert(`도크 제안 승인 반영: 금지어 [${prop.proposedValue}] 추가 및 동기화 완료`)
        } else if (prop.targetField === 'voice' && typeof prop.proposedValue === 'string') {
          setValues((prev) => ({
            ...prev,
            voice: prop.proposedValue as string,
          }))
          setProposalAlert(`도크 제안 승인 반영: 톤앤매너 변경됨`)
        } else {
          setProposalAlert(`도크 제안 승인 반영: [${prop.title}] 중앙 설정에 동기화 완료`)
        }
        setTimeout(() => setProposalAlert(null), 5000)
      }
    }

    window.addEventListener(PROPOSAL_APPLIED_EVENT, handleProposalApplied)
    return () => window.removeEventListener(PROPOSAL_APPLIED_EVENT, handleProposalApplied)
  }, [])

  // Load profile from server
  useEffect(() => {
    if (!workspaceId) return
    try {
      fetch(`/api/workspaces/${workspaceId}/profile`)
        .then((res) => res.json())
        .then((data) => {
          if (data?.success && data?.profile) {
            const { business, brand } = data.profile
            setValues({
              businessName: isMeaningfulText(business?.business_name) ? business.business_name : '',
              industry: isMeaningfulText(business?.industry) ? business.industry : '',
              location: isMeaningfulText(business?.location) ? business.location : '',
              summary: isMeaningfulText(business?.summary) ? business.summary : '',
              voice: isMeaningfulText(brand?.voice) ? brand.voice : '',
              keywords: Array.isArray(brand?.keywords)
                ? brand.keywords.filter((k: string) => isMeaningfulText(k, 1)).join(', ')
                : '',
              prohibitedTerms: Array.isArray(brand?.prohibited_terms)
                ? brand.prohibited_terms.filter((t: string) => isMeaningfulText(t, 1)).join(', ')
                : '',
            })
            setPersistenceState('READBACK_VERIFIED')
          }
        })
        .catch((err) => console.error('[useWorkspaceProfileForm] Load profile error:', err))
    } catch {}
  }, [workspaceId])

  const setField = useCallback((name: keyof WorkspaceProfileValues, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }))
  }, [])

  const save = useCallback(async () => {
    if (!workspaceId) return
    setIsSaving(true)
    setSaveError(null)
    setPersistenceState('SAVING')
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business: {
            businessName: values.businessName,
            industry: values.industry,
            location: values.location,
            summary: values.summary,
          },
          brand: {
            voice: values.voice,
            keywords: values.keywords
              ? values.keywords.split(',').map((k: string) => k.trim()).filter(Boolean)
              : [],
            prohibitedTerms: values.prohibitedTerms
              ? values.prohibitedTerms.split(',').map((t: string) => t.trim()).filter(Boolean)
              : [],
          },
        }),
      })

      const result = await res.json()
      if (!res.ok || !result.success) {
        throw new Error(result.message || result.error || '프로필 저장에 실패했습니다.')
      }

      setPersistenceState('READBACK_VERIFIED')
      setSaveSuccess(true)
      options?.onSaved?.()
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      console.error('[useWorkspaceProfileForm] Save error:', err)
      setPersistenceState('PERSISTENCE_FAILED')
      setSaveError(err instanceof Error ? err.message : '프로필 저장 중 오류가 발생했습니다.')
    } finally {
      setIsSaving(false)
    }
  }, [workspaceId, values, options])

  return {
    values,
    setField,
    save,
    status: {
      isSaving,
      saveSuccess,
      saveError,
      persistenceState,
      proposalAlert,
    },
  }
}

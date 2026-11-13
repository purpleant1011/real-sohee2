'use client'

import { useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import type { DiagnosisInput } from './diagnosis-schema'
import { buildDiagnosisOnboardingDraft, clearDiagnosisIntent, DIAGNOSIS_INTENT_KEY, loadDiagnosisIntent } from './diagnosis-intent'
import styles from './diagnosis.module.css'

const subscribe = () => () => undefined
const getServerSnapshot = () => null
const getSnapshot = () => sessionStorage.getItem(DIAGNOSIS_INTENT_KEY)

export function DiagnosisOnboardingIntent({ onUse }: Readonly<{ onUse(draft: string): void }>) {
  const storedIntent = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const [dismissed, setDismissed] = useState(false)
  const intent = storedIntent && !dismissed ? loadDiagnosisIntent() : null
  if (!intent) return null

  function dismiss() {
    clearDiagnosisIntent()
    setDismissed(true)
  }

  function useIntent() {
    onUse(buildDiagnosisOnboardingDraft(intent as DiagnosisInput))
    dismiss()
  }

  return (
    <section aria-labelledby="diagnosis-intent-title" className={styles.onboardingIntent}>
      <p>무료 진단에서 이어짐</p>
      <h2 id="diagnosis-intent-title">무료 진단에서 알려준 내용을 먼저 확인할까요?</h2>
      <dl>
        <div><dt>매장</dt><dd>{intent.businessName}</dd></div>
        <div><dt>가장 먼저 해결할 문제</dt><dd>{buildDiagnosisOnboardingDraft(intent)}</dd></div>
      </dl>
      <small>아직 저장되지 않았어요. 답변 입력란에서 고친 뒤 직접 보내야 나의 소희 후보가 됩니다.</small>
      <div>
        <Button onClick={useIntent}>이 내용으로 대화 시작</Button>
        <Button className={styles.intentSecondary} onClick={dismiss}>직접 다시 말하기</Button>
      </div>
    </section>
  )
}

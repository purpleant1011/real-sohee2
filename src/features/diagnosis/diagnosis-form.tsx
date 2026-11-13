'use client'

import Link from 'next/link'
import { useState } from 'react'
import { buildPreliminaryDiagnosis } from './diagnosis-model'
import { saveDiagnosisIntent } from './diagnosis-intent'
import { diagnosisInputSchema, type DiagnosisInput, type DiagnosisResult } from './diagnosis-schema'
import styles from './diagnosis.module.css'

const initial: DiagnosisInput = { businessName: '', industry: 'beauty', problem: 'inquiry', channel: 'instagram' }

export function DiagnosisForm() {
  const [input, setInput] = useState(initial)
  const [result, setResult] = useState<DiagnosisResult | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  function change<K extends keyof DiagnosisInput>(key: K, value: DiagnosisInput[K]) { setInput((current) => ({ ...current, [key]: value })) }
  function submit(event: React.FormEvent) { event.preventDefault(); const parsed = diagnosisInputSchema.safeParse(input); if (!parsed.success) { setMessage(parsed.error.issues[0]?.message ?? '입력 내용을 확인해 주세요.'); return } setMessage(null); setResult(buildPreliminaryDiagnosis(parsed.data)) }
  return <div className={styles.layout}><form className={styles.form} onSubmit={submit}><label>매장 이름<input value={input.businessName} onChange={(event) => change('businessName', event.target.value)} placeholder="예: 별빛 헤어" /></label><label>업종<select value={input.industry} onChange={(event) => change('industry', event.target.value as DiagnosisInput['industry'])}><option value="beauty">미용</option><option value="food">외식</option><option value="education">교육</option><option value="local-service">생활 서비스</option></select></label><label>가장 해결하고 싶은 문제<select value={input.problem} onChange={(event) => change('problem', event.target.value as DiagnosisInput['problem'])}><option value="inquiry">문의</option><option value="booking">예약</option><option value="content">콘텐츠</option><option value="repeat-visit">재방문</option></select></label><label>공개 채널<select value={input.channel} onChange={(event) => change('channel', event.target.value as DiagnosisInput['channel'])}><option value="instagram">인스타그램</option><option value="threads">스레드</option><option value="naver-blog">네이버 블로그</option><option value="naver-place">네이버 플레이스</option><option value="daangn-business">당근 비즈프로필</option></select></label><button type="submit">내 매장 진단 보기</button><p role={message ? 'alert' : 'status'}>{message}</p></form>{result ? <section className={styles.result}><p>입력 내용을 바탕으로 준비한 예비 진단</p><h2>{input.businessName}에서 먼저 확인할 고객 행동</h2><ul>{result.customerQuestions.map((question) => <li key={question}>{question}</li>)}</ul><strong>{result.missedAction}</strong><h3>이번 주 추천 주제</h3><ol>{result.recommendedTopics.map((topic) => <li key={topic}>{topic}</li>)}</ol><Link href="/signup?source=diagnosis" onClick={() => saveDiagnosisIntent(input)}>이 진단으로 소희 시작하기</Link></section> : null}</div>
}

/** 대화 복원용 공개 결과. 원본 도구 인자·로그·추론은 포함하지 않는다. */
export interface PublicChatResult {
  content: string
  threadId?: string
  runId?: string
  missionId?: string
  planVersion?: number
  step?: string
  plan?: { title: string; steps: string[] }
  reviewHref?: string
  links: { label: string; href: string }[]
}

export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
export function chatId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : undefined
}
function text(value: unknown, max = 20000): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
}
function resultHref(value: unknown): string | undefined {
  if (typeof value !== 'string' || /[\\\u0000- ]/.test(value)) return
  if (/^\/app\/(content|missions|approvals|studio)(\/|\?|$)/.test(value)) return value
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href
  } catch { /* 잘못된 링크는 표시하지 않는다. */ }
}

export function projectPublicChatResult(value: unknown): PublicChatResult | null {
  const source = record(value)
  if (!source || source.status === 'FAILED' || source.step === 'ERROR') return null
  const content = text(source.content) ?? text(source.reply)
  if (!content) return null
  const missionId = chatId(source.missionId)
  const plan = record(source.planCard) ?? record(source.plan)
  const steps = Array.isArray(plan?.steps) ? plan.steps.flatMap(step => {
    const name = text(typeof step === 'string' ? step : record(step)?.name, 240)
    return name ? [name] : []
  }).slice(0, 20) : []
  const approval = record(source.approvalCard)
  const approvalId = chatId(approval?.approvalId)
  const needsReview = source.step === 'AWAITING_APPROVAL' || !!approval || typeof source.reviewHref === 'string'
  const links: PublicChatResult['links'] = []
  const evidence = record(source.evidenceResultCard)
  const candidates = Array.isArray(source.links) ? source.links : Array.isArray(evidence?.verifiedUrls)
    ? evidence.verifiedUrls.map(item => ({ label: '결과 링크 확인', href: record(item)?.url })) : []
  for (const item of candidates.slice(0, 10)) {
    const entry = record(item)
    const href = resultHref(entry?.href)
    if (href) links.push({ label: text(entry?.label, 100) ?? '결과 링크 확인', href })
  }
  const studio = resultHref(source.openInStudioPath)
  if (studio?.startsWith('/app/')) links.push({ label: '초안 열기', href: studio })
  return {
    content,
    ...(chatId(source.threadId) ? { threadId: chatId(source.threadId) } : {}),
    ...(chatId(source.runId) ? { runId: chatId(source.runId) } : {}),
    ...(missionId ? { missionId } : {}),
    ...(Number.isSafeInteger(source.planVersion) && Number(source.planVersion) >= 0 ? { planVersion: Number(source.planVersion) } : {}),
    ...(typeof source.step === 'string' && ['GENERAL_REPLY', 'MCP_TOOL_EXECUTED', 'INTERVIEW_QUESTION', 'AWAITING_APPROVAL', 'BLOCKED'].includes(source.step) ? { step: source.step } : {}),
    ...(text(plan?.title, 240) ? { plan: { title: text(plan?.title, 240)!, steps } } : {}),
    ...(needsReview ? { reviewHref: approvalId ? `/app/approvals/${approvalId}` : missionId ? `/app/missions/${missionId}` : '/app/approvals' } : {}),
    links,
  }
}

export type LoadState = 'loading' | 'ready' | 'error' | 'unknown' | 'stale'
export type DatasetMode = 'ACTUAL' | 'DEMO' | 'TEST' | 'UNKNOWN'
export interface Remote<T> {
  state: LoadState
  data: T | null
  observedAt: string | null
  validUntil: string | null
}
export interface MobileDecision {
  id: string
  kind: 'post_publish' | 'dm_reply' | 'comment_reply' | 'proposal'
  title: string
  targetLabel: string
  createdAt: string
  expiresAt: string | null
}
export interface DecisionPage {
  items: MobileDecision[]
  total: number | null
  complete: boolean
}
export interface MobileMetric {
  id: 'published' | 'bookings' | 'revenue'
  label: string
  value: number | null
  unit: '건' | '원'
  state: LoadState
  evidenceRef: string | null
  /** 숫자를 읽은 원장·연동. 출처를 댈 수 없는 값에는 숫자도 붙이지 않는다. */
  source?: string | null
  datasetMode: DatasetMode
  period: { start: string; end: string; timeZone: string } | null
}
export interface MobileActivity {
  id: string
  title: string
  statusLabel: string
  observedAt: string
  evidenceRef: string | null
}
export interface MobileHomeDto {
  workspaceId: string
  businessName: string | null
  timeZone: string | null
  generatedAt: string
  agent: Remote<{ label: string; detailHref: string }>
  decisions: Remote<DecisionPage>
  activity: Remote<MobileActivity[]>
  results: Remote<MobileMetric[]>
}
export interface MobileApprovalView {
  workspaceId: string
  id: string
  kind: MobileDecision['kind']
  title: string
  targetLabel: string | null
  sourceText: string | null
  fullContent: string | null
  imageUrls: string[]
  datasetMode: DatasetMode
  writeState: 'unsupported'
  reason: string
}
export const unknown = <T>(): Remote<T> => ({ state: 'unknown', data: null, observedAt: null, validUntil: null })
export const failed = <T>(): Remote<T> => ({ state: 'error', data: null, observedAt: null, validUntil: null })
export const ready = <T>(data: T, observedAt: string): Remote<T> => ({ state: 'ready', data, observedAt, validUntil: null })

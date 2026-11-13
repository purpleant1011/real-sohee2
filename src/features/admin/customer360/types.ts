export type TimelineKind =
  | 'signup' | 'onboarding' | 'draft' | 'approval' | 'vault' | 'preflight'
  | 'release_request' | 'publish_attempt' | 'receipt' | 'credit' | 'inquiry' | 'operator'

export type SourceKey =
  | 'workspace' | 'onboarding' | 'content' | 'approvals' | 'vault' | 'preflight'
  | 'external_actions' | 'credits' | 'inquiries' | 'operator'

/** ok = queried successfully (may be empty), error = query failed, not_connected = no data source exists yet, truncated = row count exceeded 1000 limit. */
export type SourceStatus = 'ok' | 'error' | 'not_connected' | 'truncated'

export interface ChainLink {
  label: string
  /** null = target does not exist; UI must show 연결 전 instead of a link. */
  href: string | null
  canonicalId: string | null
}

export interface TimelineEvent {
  /** `${type}:${id}` — the same identifier the customer site uses for the same fact. */
  canonicalId: string
  kind: TimelineKind
  source: SourceKey
  occurredAt: string
  title: string
  /** Masked, one line. */
  detail: string
  outcome: 'ok' | 'fail' | 'unknown' | 'neutral'
  /** Related canonical ids used to build chains. */
  refs: Readonly<Record<string, string | null>>
}

export interface SourceReport { source: SourceKey; label: string; status: SourceStatus; count: number; message?: string }

export interface Chain { title: string; steps: ChainLink[]; verdict: string }

export interface Customer360Timeline {
  workspaceId: string
  events: TimelineEvent[]
  sources: SourceReport[]
  chains: Chain[]
}

export interface DbRead { from(table: string): any }

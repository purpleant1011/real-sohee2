import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyNotice, LoadErrorNotice, MetricTile, PageHeader } from '@/components/admin-ui/data-state'
import { formatKst, publishStateLabel, referenceCode } from '@/components/admin-ui/labels'
import type { AdminMetric } from '../same-truth/read-model'
import type { MonitorItemRow, VaultMonitorResult } from './monitor'

const GATE_LABELS: Record<string, string> = {
  HELD_USER: '사용자 보류',
  USER_HELD: '사용자 보류',
  REVIEW_PENDING: '심사 대기',
  CONNECTION_PENDING: '연동 준비 중',
  READY: '발행 준비 완료',
  RELEASED: '발행 완료',
}

function gateLabel(gate: string | null | undefined): string {
  if (!gate) return '미지정'
  return GATE_LABELS[gate] ?? gate
}

function metricSourceLabel(source: string | null | undefined): string {
  if (!source) return '확인 전'
  if (source === 'public.vault_items' || source === 'vault_items') return '보관함 기록'
  if (source === 'public.vault_items + public.external_action_requests') return '보관함·외부 게시 기록'
  return '출처 확인 필요'
}

function MetricCard({ title, metric, tone }: { title: string; metric: AdminMetric<number>; tone?: 'danger' }) {
  const statusLabel = metric.status === 'FRESH' ? '최신' : metric.status === 'STALE' ? '갱신 필요' : '확인 전'
  const isDanger = tone === 'danger' && (metric.value ?? 0) > 0
  return (
    <MetricTile
      label={title}
      value={metric.value === null ? null : `${metric.value}건`}
      tone={isDanger ? 'bad' : 'default'}
      footer={
        <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground" aria-label={`자료 상태: ${statusLabel}`}>
          <div>상태: <span className="font-medium text-foreground">{statusLabel}</span></div>
          <div>출처: {metricSourceLabel(metric.source)}</div>
          <div>기준 시각: {formatKst(metric.freshness_at)}</div>
        </div>
      }
    />
  )
}

function ItemTable({ title, rows, empty, unknown }: { title: string; rows: MonitorItemRow[]; empty: string; unknown: boolean }) {
  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="text-base font-semibold">{title}</h2>
      {unknown ? (
        <LoadErrorNotice what="일부 작업공간 데이터" />
      ) : rows.length === 0 ? (
        <EmptyNotice title={empty} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>작업공간</TableHead>
                <TableHead>보관 항목</TableHead>
                <TableHead>채널</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>경과일</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.itemId} className="hover:bg-muted/30">
                  <TableCell className="font-mono text-xs font-medium">
                    {referenceCode(row.workspaceId)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {referenceCode(row.itemId)}
                  </TableCell>
                  <TableCell>{row.channelLabel}</TableCell>
                  <TableCell>{row.statusLabel}</TableCell>
                  <TableCell>{row.ageDays}일</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}

export function VaultMonitorView({ result }: { result: VaultMonitorResult }) {
  if (result.kind === 'error') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="보관함 감시"
          description="고객 보관함 접근과 변경을 점검하고, 외부 게시 전 보관 원칙 위반 여부를 확인하세요."
        />
        <LoadErrorNotice what="보관함 모니터 정보" retryHref="/admin/vault" />
      </div>
    )
  }
  const partial = result.failedWorkspaceCount > 0
  return (
    <div className="space-y-6">
      <PageHeader
        title="보관함 감시"
        description="고객 보관함 접근과 변경을 점검하고, 외부 게시 전 보관 원칙 위반 여부를 확인하세요."
      />

      <div className="text-xs text-muted-foreground">
        외부 게시 전 보관 상태만 집계합니다 · 기준 시각: {formatKst(result.observedAt)}
      </div>

      {result.cards.violations.value !== null && result.cards.violations.value > 0 && (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
          <p className="font-semibold text-destructive">
            중요 경고: 보관 상태 항목에 외부 게시 기록 {result.cards.violations.value}건이 연결되어 있습니다.
          </p>
          <p className="mt-1 text-xs text-destructive/90">
            &apos;외부 게시 0건&apos; 원칙 위반입니다. 아래 연결 내역으로 원인을 추적하세요.
          </p>
        </div>
      )}

      {partial && (
        <LoadErrorNotice what={`작업공간 ${result.failedWorkspaceCount}곳의 데이터`} />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard title="보관 건수" metric={result.cards.stored} />
        <MetricCard title="재확인 필요" metric={result.cards.needsReapproval} />
        <MetricCard title="무효 항목" metric={result.cards.invalidated} />
        <MetricCard title="외부 게시 기록 연결 건수" metric={result.cards.violations} tone="danger" />
        <MetricCard title={`보관 후 ${result.staleAfterDays}일 초과`} metric={result.cards.staleHeld} />
        <MetricCard title={`무효 ${result.staleAfterDays}일 초과 방치`} metric={result.cards.neglectedInvalidated} />
      </div>

      <section className="space-y-3" aria-label="작업공간별 현황">
        <h2 className="text-base font-semibold">작업공간별 현황</h2>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>작업공간</TableHead>
                <TableHead>보관</TableHead>
                <TableHead>채널별</TableHead>
                <TableHead>심사 대기</TableHead>
                <TableHead>연동 준비 중</TableHead>
                <TableHead>사용자 보류</TableHead>
                <TableHead>재확인 필요</TableHead>
                <TableHead>가장 오래된 보관</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.workspaces.map((w) => (
                <TableRow key={w.workspaceId} className="hover:bg-muted/30">
                  <TableCell className="font-mono text-xs font-medium">
                    {referenceCode(w.workspaceId)} {!w.countedInTotals && <Badge variant="outline" className="ml-1 text-[10px]">합계 제외</Badge>}
                  </TableCell>
                  {w.status === 'ERROR' ? (
                    <TableCell colSpan={7} className="text-amber-800 dark:text-amber-300 font-medium">
                      읽기 실패 · 확인 전
                    </TableCell>
                  ) : (
                    <>
                      <TableCell>{w.storedCount}건</TableCell>
                      <TableCell>{w.channelDistribution.length ? w.channelDistribution.map((c) => `${c.channelLabel} ${c.count}`).join(' · ') : '없음'}</TableCell>
                      <TableCell>{w.gates.reviewPending}</TableCell>
                      <TableCell>{w.gates.connectionPending}</TableCell>
                      <TableCell>{w.gates.userHeld}</TableCell>
                      <TableCell>{w.needsReapprovalCount}건</TableCell>
                      <TableCell>{w.oldestHeldAgeDays === null ? '없음' : `${w.oldestHeldAgeDays}일`}</TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {result.violations.length > 0 && (
        <section className="space-y-3" aria-label="불변식 위반 연결 내역">
          <h2 className="text-base font-semibold text-destructive">불변식 위반 연결 내역 (관리자 전용 정밀 조사)</h2>
          {result.detailsWithheld ? (
            <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              열람 기록을 남기지 못해 승인 지문과 식별자는 숨겼습니다. 위반 건수 {result.violations.length}건은 유효합니다.
            </div>
          ) : (
            <details open className="rounded-lg border bg-card p-4">
              <summary className="cursor-pointer text-sm font-semibold text-foreground hover:underline">
                정밀 조사 정보 접기/펼치기 (승인 지문 및 외부 작업 번호 {result.violations.length}건)
              </summary>
              <div className="mt-4 overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>작업공간</TableHead>
                      <TableHead>보관 항목</TableHead>
                      <TableHead>보관 단계</TableHead>
                      <TableHead>승인 지문</TableHead>
                      <TableHead>외부 작업 번호</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.violations.map((v) => (
                      <TableRow key={v.itemId} className="hover:bg-muted/30">
                        <TableCell className="font-mono text-xs">{referenceCode(v.workspaceId)}</TableCell>
                        <TableCell className="font-mono text-xs">{referenceCode(v.itemId)} · {v.channelLabel}</TableCell>
                        <TableCell className="text-xs">{gateLabel(v.releaseGate)}</TableCell>
                        <TableCell className="font-mono text-xs break-all text-muted-foreground">{v.approvedFingerprint ?? '없음'}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {v.externalActions.map((a) => `${a.id} (${publishStateLabel(a.status)})`).join(', ')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
          )}
        </section>
      )}

      <ItemTable title={`보관 후 ${result.staleAfterDays}일 초과`} rows={result.staleHeld} empty="해당 항목이 없습니다." unknown={partial} />
      <ItemTable title="무효 상태로 방치된 항목" rows={result.neglectedInvalidated} empty="해당 항목이 없습니다." unknown={partial} />
    </div>
  )
}

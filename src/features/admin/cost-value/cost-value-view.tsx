import type { CostValueResult } from './cost-value'
import { EmptyNotice, LoadErrorNotice, PageHeader } from '@/components/admin-ui/data-state'
import { formatKst } from '@/components/admin-ui/labels'

export function CostValueView({ result, versionLabel }: Readonly<{ result: CostValueResult; versionLabel: string }>) {
  return (
    <section aria-labelledby="cost-value-title" className="space-y-6">
      <PageHeader
        title="비용 대비 가치"
        description="가입 후 첫 보관까지 쓴 크레딧을 보여줘요. 보관과 미리보기는 외부 호출이 없어 생성 비용만 집계해요."
        actions={<span className="text-xs text-muted-foreground font-mono">현재 버전 {versionLabel}</span>}
      />

      {result.kind === 'error' ? (
        <LoadErrorNotice what="비용 대비 가치 자료" retryHref="/admin/cost" />
      ) : (
        <>
          <p className="rounded-xl border border-border/70 bg-muted/40 p-3.5 text-xs text-muted-foreground leading-relaxed">
            실제 원가: <strong className="text-foreground">{result.costSource}</strong>. 채널 변환 생성의 건당 비용 추세: <strong className="text-foreground">{result.transformTrend}</strong>. 원가가 기록되는 호출 로그가 아직 없어 추정 숫자를 만들지 않아요.
          </p>
          {result.rows.length === 0 ? (
            <EmptyNotice
              title="표시할 워크스페이스가 아직 없어요"
              description="가입된 워크스페이스 데이터가 확인되지 않았습니다."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border/80 bg-card">
              <table className="w-full text-sm">
                <caption className="sr-only">워크스페이스별 첫 가치까지의 크레딧</caption>
                <thead className="bg-muted/40 border-b border-border/80">
                  <tr className="text-left">
                    <th scope="col" className="p-3 font-semibold text-muted-foreground">워크스페이스</th>
                    <th scope="col" className="p-3 font-semibold text-muted-foreground">가입</th>
                    <th scope="col" className="p-3 font-semibold text-muted-foreground">첫 보관</th>
                    <th scope="col" className="p-3 font-semibold text-muted-foreground">쓴 크레딧</th>
                    <th scope="col" className="p-3 font-semibold text-muted-foreground">측정된 호출</th>
                    <th scope="col" className="p-3 font-semibold text-muted-foreground">실제 원가</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {result.rows.map((row) => (
                    <tr key={row.workspaceId} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3 font-medium text-foreground">{row.name}</td>
                      <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{formatKst(row.signedUpAt)}</td>
                      <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{row.reachedFirstValue ? formatKst(row.firstValueAt) : '아직 없음'}</td>
                      <td className="p-3 font-mono text-xs font-semibold text-foreground">
                        {row.creditsToFirstValue.toLocaleString()} SC{row.reachedFirstValue ? '' : ' (첫 보관 전)'}
                      </td>
                      <td className="p-3 text-xs text-foreground font-mono">{row.measuredCallCount}건</td>
                      <td className="p-3 text-xs text-muted-foreground">{row.costToFirstValue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}

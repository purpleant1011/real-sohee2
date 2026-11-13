import { requireOperator } from '@/features/operator-auth/require-operator'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyNotice, LoadErrorNotice, MetricTile, PageHeader } from '@/components/admin-ui/data-state'
import { formatKst, referenceCode } from '@/components/admin-ui/labels'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { listFeedbackForAdmin } from '@/features/feedback/repository'
import { triageFeedbackAction } from '@/features/feedback/admin-actions'
import { FEEDBACK_STATUSES, FEEDBACK_TAGS, KIND_LABEL, STATUS_LABEL, TAG_LABEL } from '@/features/feedback/types'

export const dynamic = 'force-dynamic'

export default async function AdminFeedbackPage() {
  await requireOperator('workspace.read')
  const result = await listFeedbackForAdmin(createAdminSupabaseClient() as never)

  if (result.status === 'ERROR') {
    return (
      <main className="p-6 space-y-6">
        <PageHeader
          title="고객 의견"
          description="고객이 남긴 의견과 불만을 확인하고 분류·처리 상태를 기록하세요."
        />
        <LoadErrorNotice what="고객 의견 목록" retryHref="/admin/feedback" />
      </main>
    )
  }

  const pendingCount = result.items.filter((i) => i.status === 'NEW' || (i.status as string) === 'open' || (i.status as string) === 'in_progress').length

  return (
    <main className="p-6 space-y-6">
      <PageHeader
        title="고객 의견"
        description="고객이 남긴 의견과 불만을 확인하고 분류·처리 상태를 기록하세요."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricTile
          label="접수된 의견"
          value={`${result.items.length}건`}
          hint="전체 누적 접수 건수"
        />
        <MetricTile
          label="확인·처리 필요"
          value={`${pendingCount}건`}
          tone={pendingCount > 0 ? 'warn' : 'default'}
          hint="미완료 상태의 의견"
        />
        <MetricTile
          label="운영 메모 안내"
          value="개인정보 입력 금지"
          hint="전화번호, 이메일 등 제외"
        />
      </div>

      {result.items.length === 0 ? (
        <EmptyNotice
          title="접수된 고객 의견이 없어요"
          description="고객이 보낸 새로운 의견이 접수되면 여기에 표시됩니다."
        />
      ) : (
        <ul className="space-y-4">
          {result.items.map((item) => (
            <li key={item.id}>
              <Card className="border shadow-xs">
                <CardContent className="p-5 space-y-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      사업장 참조번호 {referenceCode(item.workspace_id)}
                    </span>
                    <span>·</span>
                    <span>화면: {item.screen}</span>
                    <span>·</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
                      {KIND_LABEL[item.kind] ?? '기타 의견'}
                    </span>
                    {item.rating !== null && (
                      <>
                        <span>·</span>
                        <span>평점 {item.rating}점</span>
                      </>
                    )}
                    <span>·</span>
                    <span>{formatKst(item.created_at)}</span>
                    <span className="ml-auto inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-foreground dark:text-primary">
                      {STATUS_LABEL[item.status] ?? '상태 미확인'}
                    </span>
                  </div>

                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground bg-muted/30 p-3 rounded-lg border">
                    {item.message}
                  </p>

                  <form action={triageFeedbackAction} className="grid gap-3 pt-2 text-sm sm:grid-cols-2">
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="workspaceId" value={item.workspace_id} />

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`status-${item.id}`} className="text-xs font-medium text-muted-foreground">
                        처리 상태
                      </label>
                      <select
                        id={`status-${item.id}`}
                        name="status"
                        defaultValue={item.status}
                        className="h-10 rounded-lg border bg-background px-3 text-base md:text-sm focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        {FEEDBACK_STATUSES.map((s) => (
                          <option key={s} value={s}>{STATUS_LABEL[s] ?? '상태 미확인'}</option>
                        ))}
                      </select>
                    </div>

                    <fieldset className="flex flex-col gap-1.5">
                      <legend className="text-xs font-medium text-muted-foreground">태그 분류</legend>
                      <div className="flex min-h-10 flex-wrap items-center gap-2">
                        {FEEDBACK_TAGS.map((t) => (
                          <label key={t} className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs hover:bg-muted">
                            <input
                              type="checkbox"
                              name="tags"
                              value={t}
                              defaultChecked={item.tags.includes(t)}
                              className="size-3.5 rounded border-muted-foreground"
                            />
                            <span>{TAG_LABEL[t] ?? '기타 태그'}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`contentId-${item.id}`} className="text-xs font-medium text-muted-foreground">
                        연결할 콘텐츠 참조번호 (선택)
                      </label>
                      <input
                        id={`contentId-${item.id}`}
                        name="contentId"
                        defaultValue={item.content_id ?? ''}
                        placeholder="예: c1234567"
                        className="h-10 rounded-lg border bg-background px-3 text-base md:text-sm focus-visible:outline-2 focus-visible:outline-primary"
                      >
                      </input>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`runId-${item.id}`} className="text-xs font-medium text-muted-foreground">
                        연결할 실행 번호 (선택)
                      </label>
                      <input
                        id={`runId-${item.id}`}
                        name="runId"
                        defaultValue={item.run_id ?? ''}
                        placeholder="예: r1234567"
                        className="h-10 rounded-lg border bg-background px-3 text-base md:text-sm focus-visible:outline-2 focus-visible:outline-primary"
                      >
                      </input>
                    </div>

                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <label htmlFor={`adminNote-${item.id}`} className="text-xs font-medium text-muted-foreground">
                        운영 메모 (인터뷰 내용 포함, 개인정보 제외)
                      </label>
                      <textarea
                        id={`adminNote-${item.id}`}
                        name="adminNote"
                        defaultValue={item.admin_note ?? ''}
                        maxLength={2000}
                        rows={2}
                        placeholder="처리 경과나 조치 사항을 기록하세요."
                        className="rounded-lg border bg-background p-3 text-base md:text-sm focus-visible:outline-2 focus-visible:outline-primary"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <button
                        type="submit"
                        className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 text-xs font-semibold text-white shadow-xs hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        저장하기
                      </button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

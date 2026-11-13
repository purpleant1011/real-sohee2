import Link from 'next/link'
import { requireOperatorAnyScope } from '../../../features/operator-auth/require-operator'
import { DynamicOnboardingBoard } from '../../../features/operator-refine/operator-dynamic-views'
import { getOperatorOnboardingOverview } from '../../../features/operator-onboarding/lifecycle-repository'
import { listOperatorDocumentReconsentTargets } from '../../../features/operator-onboarding/document-reconsent-repository'
import {
  getPendingBusinessVerifications,
  pendingBusinessStatusLabel,
} from '../../../features/operator-onboarding/business-verification-queue'
import { LoadErrorNotice, MfaRequiredNotice, PageHeader } from '@/components/admin-ui/data-state'
import { formatRelativeKst } from '@/components/admin-ui/labels'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { ShieldAlert, ArrowRight } from 'lucide-react'

export default async function OperatorOnboardingPage() {
  await requireOperatorAnyScope('agreement.read')
  const [result, reconsentResults, pendingQueueResult] = await Promise.all([
    getOperatorOnboardingOverview(),
    Promise.all([
      listOperatorDocumentReconsentTargets('service_agreement'),
      listOperatorDocumentReconsentTargets('privacy_consent'),
      listOperatorDocumentReconsentTargets('publishing_delegation'),
    ]),
    getPendingBusinessVerifications(),
  ])

  if (result.error) {
    return (
      <main className="space-y-6 p-4 sm:p-6 max-w-6xl mx-auto">
        <PageHeader title="가입·계약" description="고객사 가입부터 계약, 게시 위임 동의, 서비스 활성화까지 관리합니다." />
        {result.error === 'MFA_REQUIRED'
          ? <MfaRequiredNotice />
          : <LoadErrorNotice what="온보딩 및 계약 현황" retryHref="/admin/onboarding" />}
      </main>
    )
  }

  const reconsentErrors = reconsentResults.filter((item) => item.error)
  const pendingQueue = pendingQueueResult.data ?? []

  return (
    <div className="space-y-6">
      {reconsentErrors.length > 0 && (
        <div className="p-4 sm:p-6 pb-0 max-w-6xl mx-auto">
          {reconsentErrors.some((item) => item.error === 'MFA_REQUIRED')
            ? <MfaRequiredNotice />
            : <LoadErrorNotice what="재동의 대상 목록" retryHref="/admin/onboarding" />}
        </div>
      )}

      {/* 사업자 인증 대기 큐 섹션 */}
      <section aria-labelledby="business-verification-queue-title" className="p-4 sm:p-6 pb-0 max-w-6xl mx-auto space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <h2 id="business-verification-queue-title" className="text-base font-bold text-foreground flex items-center gap-2">
              <ShieldAlert className="size-4 text-state-warn" aria-hidden />
              <span>사업자 인증 대기</span>
              <span className="rounded-full bg-state-warn/10 text-state-warn text-xs px-2 py-0.5 font-semibold">
                {pendingQueue.length}건
              </span>
            </h2>
            <p className="text-xs text-muted-foreground">
              가입 후 사업자 인증이 완료되지 않은 고객사(심사 대기 및 제출 전 체험회원)입니다. 상세 화면에서 사업자 정보를 확인하거나 직접 입력해 승인할 수 있어요.
            </p>
          </div>
        </div>

        {pendingQueue.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
            현재 사업자 인증 대기 중인 고객사가 없습니다.
          </div>
        ) : (
          <div className="rounded-xl border bg-card shadow-xs overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="text-xs">고객사</TableHead>
                  <TableHead className="text-xs">심사 상태</TableHead>
                  <TableHead className="text-xs">상호 / 사업자번호</TableHead>
                  <TableHead className="text-xs">가입일</TableHead>
                  <TableHead className="text-right text-xs"><span className="sr-only">상세</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingQueue.map((item) => (
                  <TableRow key={item.workspaceId} className="hover:bg-muted/30">
                    <TableCell className="text-xs font-semibold">
                      <Link href={`/admin/workspaces/${item.workspaceId}`} className="hover:underline text-foreground">
                        {item.workspaceName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.status === 'PENDING' ? 'warning' : 'outline'} className="text-[11px]">
                        {pendingBusinessStatusLabel(item.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {item.companyName ? `${item.companyName} (${item.businessNumber || '번호 미등록'})` : '사업자 정보 미제출'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatRelativeKst(item.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {item.hasDocument && (
                          <a
                            href={`/api/admin/workspaces/${item.workspaceId}/business-document?redirect=1`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-8 items-center gap-1 rounded-md border border-input px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-accent"
                          >
                            서류 보기
                          </a>
                        )}
                        <Link
                          href={`/admin/workspaces/${item.workspaceId}`}
                          className="inline-flex min-h-8 items-center gap-1 rounded-md border border-primary/30 px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-primary/10"
                        >
                          상세·심사 <ArrowRight className="size-3" aria-hidden />
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <DynamicOnboardingBoard
        overviews={result.data ?? []}
        reconsentTargets={reconsentResults.flatMap((item) => (item.data ? [item.data] : []))}
      />
    </div>
  )
}


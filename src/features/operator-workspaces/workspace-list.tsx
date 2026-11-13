'use client'

import React from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import type { OperatorWorkspaceSummary } from './schemas'
import type { z } from 'zod'
import { lifecycleStatusSchema } from './schemas'
import { OperatorStatusTag } from '@/features/operator-refine/operator-status'
import { memberStatusLabel } from '@/components/admin-ui/labels'

export type WorkspaceListProps = Readonly<{
  items: readonly OperatorWorkspaceSummary[]
  nextCursor: string | null
  query: string | null
  status: z.infer<typeof lifecycleStatusSchema> | null
  member?: 'formal' | 'applicant' | 'all' | null
}>

function lifecycleLabel(status: string | null): string {
  const labels: Record<string, string> = {
    applied: '가입 신청',
    information_pending: '정보 확인',
    contract_review: '계약 검토',
    consent_pending: '동의 대기',
    channel_pending: '채널 연결',
    payment_pending: '결제 확인',
    ready_for_activation: '활성화 준비',
    active: '활성',
    paused: '일시 중지',
    terminated: '종료',
  }
  return status ? labels[status] ?? status : '확인 전'
}

function channelTone(value: string): 'success' | 'warning' | 'critical' | 'unknown' {
  if (value === 'connected' || value === 'ready' || value === 'healthy') return 'success'
  if (value === 'error' || value === 'expired' || value === 'reverify_required' || value === 'wrong_account') return 'critical'
  if (value === 'connecting' || value === 'missing_permission') return 'warning'
  return 'unknown'
}

function countLabel(value: number | null, suffix: string): string {
  return value === null ? '확인 전' : `${value.toLocaleString('ko-KR')}${suffix}`
}

export default function WorkspaceList({ items, nextCursor, query, status, member }: WorkspaceListProps) {
  return (
    <div className="space-y-4">
      <Card className="p-0 overflow-hidden shadow-xs border border-border/80">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead>고객사</TableHead>
                <TableHead>가입·계약</TableHead>
                <TableHead>채널</TableHead>
                <TableHead>게시</TableHead>
                <TableHead>크레딧</TableHead>
                <TableHead>최근 활동</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-xs">
                    표시할 고객사 데이터가 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.workspaceId} className="hover:bg-muted/30">
                    <TableCell className="font-semibold text-xs">
                      <div className="flex items-center gap-1.5">
                        <Link href={`/admin/workspaces/${item.workspaceId}`} className="text-primary hover:underline font-bold">
                          {item.workspaceName}
                        </Link>
                        <Badge variant={item.memberStatus === 'FORMAL' ? 'success' : 'outline'} className="text-[10px]">
                          {memberStatusLabel(item.memberStatus)}
                        </Badge>
                      </div>
                      <span className="text-[11px] text-muted-foreground block mt-0.5">
                        {item.businessName ?? '사업 정보 확인 전'} · {item.planCode ?? '요금제 확인 전'} · 멤버 {item.memberCount}명
                      </span>
                    </TableCell>
                    <TableCell>
                      <OperatorStatusTag
                        label={lifecycleLabel(item.lifecycleStatus)}
                        state={item.lifecycleStatus === 'active' ? 'success' : item.lifecycleStatus ? 'warning' : 'unknown'}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <OperatorStatusTag
                          label={`Instagram · ${item.instagramStatus === 'unknown' ? '확인 전' : item.instagramStatus}`}
                          state={channelTone(item.instagramStatus)}
                        />
                        <OperatorStatusTag
                          label={`Threads · ${item.threadsStatus === 'unknown' ? '확인 전' : item.threadsStatus}`}
                          state={channelTone(item.threadsStatus)}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <strong>{countLabel(item.publishedThisMonth, '건')}</strong>
                      <span className="text-[10px] text-muted-foreground block">실패 {countLabel(item.failedThisMonth, '건')}</span>
                    </TableCell>
                    <TableCell className="text-xs font-mono font-bold">
                      {item.availableCredits === null ? (
                        <OperatorStatusTag label="확인 전" state="unknown" />
                      ) : (
                        `${item.availableCredits.toLocaleString('ko-KR')} SC`
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {item.lastActivityAt ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(item.lastActivityAt)) : '확인 전'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {nextCursor !== null ? (
        <div className="pt-2 text-right">
          <Link
            className="text-xs font-semibold text-primary hover:underline"
            href={{ pathname: '/admin/workspaces', query: { cursor: nextCursor, ...(query === null ? {} : { query }), ...(status === null ? {} : { status }), ...(member ? { member } : {}) } }}
          >
            다음 고객사 목록 보기 &rarr;
          </Link>
        </div>
      ) : null}
    </div>
  )
}

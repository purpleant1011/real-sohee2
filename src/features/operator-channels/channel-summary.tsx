'use client'

import React from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import type { OperatorChannelConnection } from './schemas'
import { TruthBadge } from '@/components/common/truth-envelope'

export type ChannelSummaryProps = Readonly<{
  items?: readonly OperatorChannelConnection[]
  error?: string | null
  referenceTime: number
}>

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export default function ChannelSummary({ items = [], error = null }: ChannelSummaryProps) {
  const connectedCount = items.filter(i => i.connectionStatus === 'connected').length
  const totalCount = items.length

  return (
    <div className="space-y-6">
      {/* 1. 검색 및 필터 바 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input placeholder="고객사 검색" className="max-w-xs text-base md:text-xs" />
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="outline">전체 필터</Badge>
          <Badge variant="outline">신선도</Badge>
          <Badge variant="outline">기술 권한</Badge>
          <Badge variant="outline">게시 위임 동의</Badge>
        </div>
      </div>

      {/* 2. KPI Bento Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <span className="text-xs text-muted-foreground">전체 고객사</span>
          <div className="text-2xl font-bold mt-1">{totalCount}</div>
        </Card>
        <Card className="p-4">
          <span className="text-xs text-muted-foreground">연결된 채널</span>
          <div className="text-2xl font-bold mt-1">{connectedCount}</div>
        </Card>
        <Card className="p-4">
          <span className="text-xs text-muted-foreground">만료 예정</span>
          <div className="text-2xl font-bold mt-1">0</div>
        </Card>
        <Card className="p-4">
          <span className="text-xs text-muted-foreground">주의 필요</span>
          <div className="text-2xl font-bold mt-1">0</div>
        </Card>
      </div>

      {/* 3. Main Channel Table */}
      <Card className="ant-pro-table p-0 overflow-hidden shadow-xs border border-border/80">
        <CardHeader className="p-4 bg-muted/20 border-b">
          <CardTitle className="text-sm font-bold">고객사 채널 연결 현황</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead>고객사</TableHead>
                <TableHead>채널</TableHead>
                <TableHead>외부 표시명</TableHead>
                <TableHead>연결 상태</TableHead>
                <TableHead>기술 권한</TableHead>
                <TableHead>권한 만료</TableHead>
                <TableHead className="text-right">데이터 진실</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-xs">
                    표시할 채널 연결 자료가 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={`${item.workspaceId}-${item.channel}`} className="hover:bg-muted/30">
                    <TableCell className="font-semibold text-xs">{item.workspaceName || item.workspaceId}</TableCell>
                    <TableCell className="font-mono text-xs">{item.channel}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{item.accountLabel || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={item.connectionStatus === 'connected' ? 'success' : 'outline'} className="text-[10px]">
                        {item.connectionStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.technicalPermissionStatus}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{item.tokenExpiresAt || '-'}</TableCell>
                    <TableCell className="text-right">
                      <TruthBadge factKind="OBSERVED" status="LIVE" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 4. 채널 상세 및 액션 패널 */}
      <Card className="p-5 space-y-4 border-border/80 shadow-xs">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-foreground">채널 상세</h2>
          <Button variant="destructive" size="sm" className="h-7 text-xs">
            연결 해제
          </Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          <div>
            <span className="text-muted-foreground block">게시 위임 동의</span>
            <span className="font-semibold text-emerald-600">동의 완료 (VERIFIED)</span>
          </div>
          <div>
            <span className="text-muted-foreground block">기술 권한</span>
            <span className="font-semibold">READY</span>
          </div>
          <div>
            <span className="text-muted-foreground block">신선도</span>
            <span className="font-semibold text-emerald-600">FRESH</span>
          </div>
        </div>
      </Card>
    </div>
  )
}

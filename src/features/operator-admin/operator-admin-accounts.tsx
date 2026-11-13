'use client'

import React from 'react'
import { adminRoleLabel, adminStatusLabel } from '@/components/admin-ui/labels'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { TruthBadge } from '@/components/common/truth-envelope'

import Link from 'next/link'

export interface OperatorAdminAccountsProps {
  items?: readonly any[]
  result?: any
  approvals?: any
  selectors?: any
  error?: string | null
}

export function OperatorAdminAccounts({ items, result, error = null }: OperatorAdminAccountsProps) {
  const displayItems = result?.data?.items || items || []

  return (
    <div className="space-y-6">
      <Card className="p-0 overflow-hidden shadow-xs border border-border/80">
        <CardHeader className="p-4 bg-muted/20 border-b flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-bold">운영자 계정 및 권한 관리</CardTitle>
          <Link href="/auth/admin-setup" className="text-xs font-semibold text-primary hover:underline">
            내 추가 인증 등록
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead>운영자 이메일</TableHead>
                <TableHead>역할</TableHead>
                <TableHead>추가 인증 상태</TableHead>
                <TableHead>계정 상태</TableHead>
                <TableHead className="text-right">데이터 진실</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-xs">
                    표시할 운영자 계정 자료가 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                displayItems.map((item: any) => (
                  <TableRow key={item.id} className="hover:bg-muted/30">
                    <TableCell className="font-semibold text-xs">{item.email}</TableCell>
                    <TableCell className="font-mono text-xs">{adminRoleLabel(item.role)}</TableCell>
                    <TableCell>
                      <Badge variant={item.mfaEnrolled ? 'success' : 'warning'} className="text-[10px]">
                        {item.mfaEnrolled ? '추가 인증 등록됨' : '추가 인증 미등록'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.status === 'active' ? 'success' : 'destructive'} className="text-[10px]">
                        {adminStatusLabel(item.status)}
                      </Badge>
                    </TableCell>
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
    </div>
  )
}

export default OperatorAdminAccounts

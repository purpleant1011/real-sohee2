'use client'

import React from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { TruthBadge } from '@/components/common/truth-envelope'

export interface OperatorAdminViewConfig {
  title: string
  description: string
  alert?: string
  status?: string
  summary: ReadonlyArray<readonly [string, string, string]>
  distinctSections: ReadonlyArray<readonly [string, string, string]>
  actionNote: string
  tableTitle: string
  filterLabels: readonly string[]
  columns: readonly string[]
  rows: ReadonlyArray<readonly string[]>
  detailTitle: string
  detail: ReadonlyArray<readonly [string, string]>
  actions: readonly string[]
  listTitle: string
  listItems: ReadonlyArray<readonly [string, string]>
  visualPanels: ReadonlyArray<readonly [string, string, string]>
}

export interface OperatorAdminViewProps {
  config: OperatorAdminViewConfig
  items?: readonly any[]
  liveRows?: readonly (readonly string[])[]
  liveSummary?: readonly (readonly [string, string, string])[]
  error?: string | null
}

export function OperatorAdminView({ config, liveRows, liveSummary, error = null }: OperatorAdminViewProps) {
  const isConnected = Boolean(liveRows || liveSummary)
  const summaries = liveSummary || config.summary
  const rows = liveRows || config.rows

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{config.title}</h1>
          <p className="text-xs text-muted-foreground mt-1">{config.description}</p>
        </div>
        {isConnected ? (
          <Badge variant="success" className="text-xs">운영 자료 연결됨 · 운영사 권한 범위 안의 안전한 읽기 자료</Badge>
        ) : (
          <Badge variant="outline" className="text-xs">표시값은 준비 상태</Badge>
        )}
      </header>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {summaries.map(([label, val, desc]) => (
          <Card key={label} className="p-4">
            <span className="text-xs text-muted-foreground">{label}</span>
            <div className="text-xl font-bold my-1">{val}</div>
            <span className="text-[10px] text-muted-foreground">{desc}</span>
          </Card>
        ))}
      </div>

      {/* Filters / Actions */}
      <div className="flex flex-wrap gap-2 items-center">
        {config.filterLabels.map((filter) => (
          <Button key={filter} variant="outline" size="sm" disabled className="text-xs">
            {filter} (필터 연결 전)
          </Button>
        ))}
      </div>

      {/* Main Table */}
      <Card className="ant-pro-table p-0 overflow-hidden shadow-xs border border-border/80">
        <CardHeader className="p-4 bg-muted/20 border-b">
          <CardTitle className="text-sm font-bold">
            <h2>{config.tableTitle}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                {config.columns.map((col) => (
                  <TableHead key={col}>{col}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, idx) => (
                <TableRow key={idx} className="hover:bg-muted/30">
                  {row.map((cell, cellIdx) => (
                    <TableCell key={cellIdx} className="text-xs font-medium">
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Distinct Sections & Panels */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {config.distinctSections.map(([secTitle, secStatus, secDesc]) => (
          <Card key={secTitle} className="p-4">
            <h3 className="text-sm font-bold">{secTitle}</h3>
            <Badge variant="outline" className="text-[10px] my-1">{secStatus}</Badge>
            <p className="text-xs text-muted-foreground">{secDesc}</p>
          </Card>
        ))}
      </div>
    </div>
  )
}

export default OperatorAdminView

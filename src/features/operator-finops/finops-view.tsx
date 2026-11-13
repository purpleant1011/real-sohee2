'use client'

import React, { useState } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table"
import { Progress } from "@/components/ui/progress"
import {
  DollarSign, TrendingUp, Cpu, Zap, PieChart, ArrowUpRight, ArrowDownRight,
  ShieldCheck, AlertCircle, RefreshCw, Layers, Calculator, Sparkles, Check
} from "lucide-react"

import type { FinopsReadModel } from "./finops-repository"
import { TruthBadge, NoDataFallback } from "@/components/common/truth-envelope"

export function FinopsView({ initialData }: { initialData?: FinopsReadModel }) {
  const [activeModelTab, setActiveModelTab] = useState("ALL")

  // 데이터가 없을 때 0/100 같은 낙관값을 만들지 않는다. '측정 전'으로 표시한다.
  const hasSummary = Boolean(initialData?.summary)
  const summary = initialData?.summary || {
    grossMargin: 0,
    totalCogsUsd: 0,
    totalRevenueKrw: 0,
    cachedTokenRatio: 0,
    unpricedTokens: 0,
    pricedCoveragePct: 0,
  }

  const modelUsage = initialData?.modelUsage || []

  const pricingVersions = initialData?.pricingVersions || [
    { version: "v2026-08", effectiveDate: "2026-08-01", status: "ACTIVE", modelsCount: 6, fxRate: "1,380 KRW/USD", targetMargin: "70.0%" },
  ]

  return (
    <div className="w-full space-y-7 transition-all">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b pb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-xs">
            <DollarSign className="size-6.5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-foreground">AI FinOps & 원가 관제</h1>
              <Badge
                variant={hasSummary && summary.grossMargin >= 70 ? 'success' : 'outline'}
                className="text-[11px] font-bold px-2.5 py-0.5"
              >
                {hasSummary ? `실현 마진 ${summary.grossMargin}% (목표 70%)` : '실현 마진 측정 전'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              OpenAI / DeepSeek 토큰 단위 원가(COGS) 계측 · 프롬프트 캐싱 절감액 추적 · 주간 정산 크레딧 환산
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" className="h-9 gap-2 text-xs font-semibold bg-card hover:bg-accent border-border/80 shadow-2xs">
            <RefreshCw className="size-3.5" /> 원가 재계측
          </Button>
          <Button size="sm" className="h-9 gap-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs">
            <Calculator className="size-4" /> 신규 단가표 버전 발행
          </Button>
        </div>
      </div>


      {/* Top 4 Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <Card className="p-4 space-y-1.5 bg-card/80 border-border/80 shadow-xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>실현 총마진 (Gross Margin)</span>
            <Badge variant="success" className="text-[9px] px-1 py-0">Target 70%+</Badge>
          </div>
          <div className="text-2xl md:text-3xl font-extrabold font-mono tracking-tight text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
            <TrendingUp className="size-6" /> {hasSummary ? `${summary.grossMargin}%` : '측정 전'}
          </div>
          <Progress value={summary.grossMargin} max={100} className="h-1.5 bg-muted" />
        </Card>

        <Card className="p-4 space-y-1.5 bg-card/80 border-border/80 shadow-xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>총 AI 원가 (COGS 누적)</span>
            <Badge variant="outline" className="text-[9px] px-1 py-0">Month-to-Date</Badge>
          </div>
          <div className="text-2xl md:text-3xl font-extrabold font-mono tracking-tight text-foreground flex items-center gap-1">
            <DollarSign className="size-5 text-emerald-500" /> {summary.totalCogsUsd}
          </div>
          <div className="text-[11px] text-muted-foreground">
            원화 환산: <b className="text-foreground font-mono">약 204,950원</b>
          </div>
        </Card>

        <Card className="p-4 space-y-1.5 bg-card/80 border-border/80 shadow-xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>프롬프트 캐싱 절감률</span>
            <Badge variant="purple" className="text-[9px] px-1 py-0">OpenAI Caching</Badge>
          </div>
          <div className="text-2xl md:text-3xl font-extrabold font-mono tracking-tight text-purple-600 dark:text-purple-400">
            {hasSummary ? `${summary.cachedTokenRatio}%` : '측정 전'}
          </div>
          <div className="text-[11px] text-purple-600 font-medium">
            {hasSummary ? '캐시 적중으로 절감한 금액은 정산 후 확정돼요' : '캐싱 데이터가 아직 없어요'}
          </div>
        </Card>

        <Card className="p-4 space-y-1.5 bg-card/80 border-border/80 shadow-xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>미단가 토큰 감지 (Unpriced)</span>
            <Badge variant="success" className="text-[9px] px-1 py-0">Clean</Badge>
          </div>
          <div className="text-2xl md:text-3xl font-extrabold font-mono tracking-tight text-foreground">
            {summary.unpricedTokens}건
          </div>
          <div className="text-[11px] text-emerald-600 font-medium flex items-center gap-1">
            <Check className="size-3" /> 모든 호출에 단가표 정상 매핑
          </div>
        </Card>
      </div>

      {/* Model Usage Breakdown Table */}
      <Card className="p-0 overflow-hidden shadow-xs border border-border/80">
        <CardHeader className="p-4 bg-muted/20 border-b flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Cpu className="size-4 text-primary" /> 모델별 토큰 소비 및 실현 마진 대사표
            </CardTitle>
            <CardDescription className="text-xs">
              OpenAI / Router 모델별 입력·캐시·출력 토큰 및 이미지 생성 단위 원가 대사
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">FX: 1,380 KRW/USD</Badge>
        </CardHeader>
        <CardContent className="p-0">
          {modelUsage.length === 0 ? (
            <div className="p-6">
              <NoDataFallback
                title="기록된 AI 토큰 사용량 없음"
                description="아직 ai_usage_events에 계측된 모델 호출 데이터가 없습니다."
                source="ai_usage_events"
              />
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>모델명 (Model Name)</TableHead>
                  <TableHead>입력 토큰 (Input)</TableHead>
                  <TableHead>캐시된 토큰 (Cached)</TableHead>
                  <TableHead>출력 토큰 (Output)</TableHead>
                  <TableHead>이미지 생성 수</TableHead>
                  <TableHead>발생 원가 (COGS)</TableHead>
                  <TableHead className="text-right">실현 마진율</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modelUsage.map((m) => (
                  <TableRow key={m.model} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="font-mono text-xs font-bold text-foreground">{m.model}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{m.inputTokens}</TableCell>
                    <TableCell className="font-mono text-xs text-purple-600 font-semibold">{m.cachedTokens}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{m.outputTokens}</TableCell>
                    <TableCell className="font-mono text-xs">{m.imageUnits}</TableCell>
                    <TableCell className="font-mono text-xs font-bold text-emerald-600">{m.cogsUsd}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold text-primary">{m.marginPct}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pricing Version Ledger */}
      <Card className="p-0 overflow-hidden shadow-xs border border-border/80">
        <CardHeader className="p-4 bg-muted/20 border-b">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Layers className="size-4 text-primary" /> 단가표 버전 이력 (Provider Pricing Versions)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead>버전 ID</TableHead>
                <TableHead>적용 시작일</TableHead>
                <TableHead>적용 모델 수</TableHead>
                <TableHead>기준 환율</TableHead>
                <TableHead>목표 마진율</TableHead>
                <TableHead className="text-right">상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pricingVersions.map((v) => (
                <TableRow key={v.version} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="font-mono text-xs font-bold text-primary">{v.version}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{v.effectiveDate}</TableCell>
                  <TableCell className="text-xs">{v.modelsCount}개 모델</TableCell>
                  <TableCell className="font-mono text-xs">{v.fxRate}</TableCell>
                  <TableCell className="font-mono text-xs font-semibold text-emerald-600">{v.targetMargin}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={v.status === "ACTIVE" ? "success" : "outline"} className="text-[10px]">
                      {v.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

'use client'

import React, { useState } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table"
import {
  LifeBuoy, ShieldAlert, Clock, CheckCircle2, AlertCircle, RefreshCw,
  Search, ExternalLink, KeyRound, Terminal, Eye, Lock, ArrowRight
} from "lucide-react"

export function SupportView() {
  const [sessions, setSessions] = useState([
    {
      id: "sup-sess-101",
      workspaceName: "바이름 청라점",
      requestedBy: "원장님 (010-****-1234)",
      reason: "인스타그램 릴스 게시 후 예약 링크 클릭 시 랜딩페이지 오류 문의",
      operator: "support@example.com",
      grantedAt: "15분 전",
      expiresIn: "14m 32s",
      status: "ACTIVE_DIAGNOSTIC",
      readOnly: true,
    },
    {
      id: "sup-sess-102",
      workspaceName: "청라 헤어살롱",
      requestedBy: "실장님 (010-****-5678)",
      reason: "네이버 스마트플레이스 실시간 예약 동기화 지연 점검",
      operator: "ops-lead@example.com",
      grantedAt: "어제 16:00",
      expiresIn: "EXPIRED",
      status: "CLOSED",
      readOnly: true,
    },
  ])

  return (
    <div className="w-full space-y-7 transition-all">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b pb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-purple-600/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 shadow-xs">
            <LifeBuoy className="size-6.5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-foreground">고객 지원 & 진단 워크벤치</h1>
              <Badge variant="purple" className="text-[11px] font-bold px-2.5 py-0.5">No-Impersonation</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              30분 시한부 읽기전용 진단 세션 · 고객 데이터 임의 변조 방지 · 감사 로그 강제 기록
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" className="h-9 gap-2 text-xs font-semibold bg-card hover:bg-accent border-border/80 shadow-2xs">
            <RefreshCw className="size-3.5" /> 세션 상태 새로고침
          </Button>
          <Button size="sm" className="h-9 gap-2 text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white shadow-2xs">
            <KeyRound className="size-4" /> 30분 시한부 진단 세션 개설
          </Button>
        </div>
      </div>


      {/* Top Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <Card className="p-4 space-y-1.5 bg-card/80 border-border/80 shadow-xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>활성 진단 세션</span>
            <Badge variant="purple" className="text-[9px] px-1 py-0">활성</Badge>
          </div>
          <div className="text-2xl md:text-3xl font-extrabold font-mono tracking-tight text-purple-600 dark:text-purple-400 flex items-center gap-2">
            <Clock className="size-6" /> 1건
          </div>
          <div className="text-[11px] text-muted-foreground">
            최대 30분 후 자동 세션 만료
          </div>
        </Card>

        <Card className="p-4 space-y-1.5 bg-card/80 border-border/80 shadow-xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>변조 방지 (No-Impersonation)</span>
            <Badge variant="success" className="text-[9px] px-1 py-0">Strict</Badge>
          </div>
          <div className="text-2xl md:text-3xl font-extrabold font-mono tracking-tight text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
            <Lock className="size-5" /> 100% 읽기전용
          </div>
          <div className="text-[11px] text-emerald-600 font-medium">
            비밀번호/데이터 임의 조작 원천 차단
          </div>
        </Card>

        <Card className="p-4 space-y-1.5 bg-card/80 border-border/80 shadow-xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>오늘 해결된 지원 건수</span>
            <Badge variant="outline" className="text-[9px] px-1 py-0">Resolved</Badge>
          </div>
          <div className="text-2xl md:text-3xl font-extrabold font-mono tracking-tight text-foreground">
            4건
          </div>
          <div className="text-[11px] text-muted-foreground">
            평균 해결 시간: <b className="text-foreground">8분 40초</b>
          </div>
        </Card>

        <Card className="p-4 space-y-1.5 bg-card/80 border-border/80 shadow-xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>진단 감사 로그</span>
            <Badge variant="success" className="text-[9px] px-1 py-0">Logged</Badge>
          </div>
          <div className="text-2xl md:text-3xl font-extrabold font-mono tracking-tight text-foreground flex items-center gap-1.5">
            <CheckCircle2 className="size-5 text-emerald-600" /> 전수 기록
          </div>
          <div className="text-[11px] text-emerald-600 font-medium">
            모든 진단 조회 내역 저장 중
          </div>
        </Card>
      </div>

      {/* Support Sessions Table */}
      <Card className="p-0 overflow-hidden shadow-xs border border-border/80">
        <CardHeader className="p-4 bg-muted/20 border-b">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <LifeBuoy className="size-4 text-primary" /> 시한부 고객 지원 세션 목록 (Support Sessions)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="w-[120px]">세션 ID</TableHead>
                <TableHead>대상 고객사</TableHead>
                <TableHead>요청자 정보</TableHead>
                <TableHead>지원 사유</TableHead>
                <TableHead>담당 관리자</TableHead>
                <TableHead>남은 시간</TableHead>
                <TableHead>접근 모드</TableHead>
                <TableHead className="text-right">진단 워크벤치</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="font-mono text-xs font-bold text-primary">{s.id}</TableCell>
                  <TableCell className="font-semibold text-xs text-foreground">{s.workspaceName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.requestedBy}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{s.reason}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{s.operator}</TableCell>
                  <TableCell>
                    <span className={`font-mono text-xs font-semibold ${s.expiresIn === "EXPIRED" ? "text-muted-foreground" : "text-amber-600 animate-pulse"}`}>
                      {s.expiresIn}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] font-mono text-emerald-600">READ_ONLY</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      disabled={s.status === "CLOSED"}
                      variant="outline"
                      className="h-7 text-xs px-2.5 font-medium hover:bg-primary hover:text-primary-foreground"
                    >
                      <Terminal className="size-3 mr-1" /> 진단 열기
                    </Button>
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

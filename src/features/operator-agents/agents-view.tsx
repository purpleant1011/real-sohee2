'use client'

import React, { useState, useMemo } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import {
  Bot, Play, Pause, AlertOctagon, CheckCircle2, RefreshCw, Zap, ShieldAlert,
  FileCode2, Terminal, ArrowRight, Activity, Search, Sparkles, Filter, Check, X,
  ExternalLink, Layers, ArrowUpRight, Cpu, Eye, ShieldCheck, Flame
} from "lucide-react"
import { ExceptionReconcileQueue } from "@/components/admin/exception-reconcile-queue"
import { ActionRunInspector } from "@/components/admin/action-run-inspector"


export function AgentsView() {
  const [activeTab, setActiveTab] = useState("runs")
  const [globalPaused, setGlobalPaused] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("ALL")
  const [selectedRun, setSelectedRun] = useState<any | null>(null)

  const runs: Array<{
    id: string
    mission: string
    workspace: string
    action: string
    risk: string
    status: string
    model: string
    reservedSc: number
    elapsed: string
    intent: string
    toolsUsed: string[]
    currentStep: string
    progress: number
  }> = []

  const missions = [
    { id: "mis-801", title: "인스타그램 룩북 릴스 자동화", category: "GROWTH", successRate: "98.5%", avgSc: 320, activeWorkspaces: 8, status: "ACTIVE", desc: "고화질 AI 룩북 이미지 생성과 릴스 카드뉴스를 주 3회 정기 자동 편성합니다." },
    { id: "mis-802", title: "네이버 블로그 SEO 시술 후기 원고 작성", category: "SEO", successRate: "95.2%", avgSc: 450, activeWorkspaces: 6, status: "ACTIVE", desc: "지역 키워드(예: 청라 눈썹문신)를 타겟팅한 고품질 시술 사례 블로그 아티클을 작성합니다." },
    { id: "mis-803", title: "카카오톡 채널 예약 리마인드 톡", category: "CRM", successRate: "99.8%", avgSc: 120, activeWorkspaces: 11, status: "ACTIVE", desc: "시술 D-1일 및 방문 30일 경과 고객 대상 맞춤 리텐션 알림을 발송합니다." },
    { id: "mis-804", title: "당근마켓 첫방문 15% 혜택 소식 원고", category: "ACQUISITION", successRate: "94.0%", avgSc: 280, activeWorkspaces: 5, status: "ACTIVE", desc: "반경 3km 내 동네 이웃을 위한 첫방문 지원 혜택 소식 초안을 작성합니다." },
    { id: "mis-805", title: "공실 슬롯 긴급 타임세일 자동화", category: "GROWTH", successRate: "97.1%", avgSc: 200, activeWorkspaces: 9, status: "ACTIVE", desc: "당일 빈 예약 슬롯 발생 시 3시간 전 인스타 스토리 및 채널 메시지로 자동 모객합니다." },
  ]

  const mcpTools = [
    { name: "mcp_generate_visual_image", category: "CREATIVE", desc: "GPT-Image-2 최신 엔진 1024x1024 초고화질 뷰티/인테리어 실사 이미지 생성", latency: "3.2s", success: "99.8%", cost: "150 SC" },
    { name: "mcp_get_slot_occupancy", category: "ANALYTICS", desc: "실시간 네이버/카카오 예약 캘린더 공실률 진단 및 유휴 시간대 추출", latency: "180ms", success: "100.0%", cost: "0 SC" },
    { name: "mcp_post_instagram_carousel", category: "PUBLISHING", desc: "인스타그램 비즈니스 계정 4단 캐러셀 카드뉴스 및 캡션 자동 게시", latency: "2.4s", success: "98.2%", cost: "200 SC" },
    { name: "mcp_post_threads_update", category: "PUBLISHING", desc: "스레드 텍스트+이미지 마케팅 인사이트 마이크로 블로깅", latency: "1.1s", success: "99.4%", cost: "50 SC" },
    { name: "mcp_post_naver_blog", category: "PUBLISHING", desc: "네이버 블로그 복사용 원고 및 이미지 레이아웃 구성", latency: "5.8s", success: "95.5%", cost: "250 SC" },
    { name: "mcp_post_danggeun_story", category: "PUBLISHING", desc: "당근마켓 비즈프로필 동네 소식 원고 및 안내 초안 구성", latency: "2.8s", success: "96.2%", cost: "100 SC" },
    { name: "mcp_emergency_killswitch", category: "CONTROL", desc: "이상 징후 감지 시 모든 백그라운드 미션 및 외부 디스패치 즉시 차단", latency: "45ms", success: "100.0%", cost: "0 SC" },
    { name: "mcp_control_autonomy", category: "CONTROL", desc: "자율 실행 등급(MANUAL / GUARDED_AUTO / FULL_AUTO) 동적 제어", latency: "50ms", success: "100.0%", cost: "0 SC" },
  ]

  const filteredMissions = useMemo(() => {
    return missions.filter((m) => {
      const matchCat = selectedCategory === "ALL" || m.category === selectedCategory
      const matchSearch = m.title.toLowerCase().includes(searchQuery.toLowerCase()) || m.id.toLowerCase().includes(searchQuery.toLowerCase())
      return matchCat && matchSearch
    })
  }, [missions, selectedCategory, searchQuery])

  return (
    <div className="w-full space-y-7 transition-all">
      {/* 1. Header with Global Kill-Switch */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b pb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-purple-600/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 shadow-xs">
            <Bot className="size-6.5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-foreground">AI 에이전트 런타임 관제</h1>
              <Badge variant="purple" className="text-[11px] font-bold px-2.5 py-0.5">V0.8.8 Engine</Badge>
              <Badge variant="outline" className="text-[11px] font-mono border-emerald-500/30 text-emerald-600 bg-emerald-500/5">
                80 Missions Loaded
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              자연어 Intent ➔ ActionGraph 파이프라인 · 80대 Growth Missions · 18대 Master MCP Tools 중앙 관제
            </p>
          </div>
        </div>


        <div className="flex items-center gap-2.5">
          <Button
            size="sm"
            variant={globalPaused ? "default" : "destructive"}
            onClick={() => setGlobalPaused(!globalPaused)}
            className="h-9 gap-2 text-xs font-semibold shadow-xs transition-transform active:scale-95"
          >
            {globalPaused ? <Play className="size-4" /> : <AlertOctagon className="size-4" />}
            {globalPaused ? "전역 에이전트 재개" : "전역 에이전트 긴급 일시중지 (Kill Switch)"}
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-2 text-xs font-medium bg-card">
            <RefreshCw className="size-3.5" /> 런타임 갱신
          </Button>
        </div>
      </div>

      {globalPaused && (
        <div className="p-4 rounded-xl border border-destructive bg-destructive/10 text-destructive flex items-center justify-between animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <ShieldAlert className="size-6 animate-pulse" />
            <div>
              <h4 className="font-bold text-sm">전역 에이전트 긴급 일시정지 (활성)</h4>
              <p className="text-xs opacity-90">
                모든 워크스페이스의 백그라운드 미션 스캔 및 외부 SNS 자동 디스패치가 안전하게 차단되었습니다.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setGlobalPaused(false)} className="h-8 text-xs bg-background text-foreground font-semibold">
            정상 모드로 복구
          </Button>
        </div>
      )}

      {/* 2. Top Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <Card className="p-4 space-y-1.5 bg-card/80 border-border/80 shadow-xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>활성 실행 런 (Live Runs)</span>
            <Badge variant="purple" className="text-[9px] px-1 py-0">Running</Badge>
          </div>
          <div className="text-2xl md:text-3xl font-extrabold font-mono tracking-tight text-foreground flex items-center gap-2">
            <Bot className="size-6 text-purple-600" /> {runs.length}
            <span className="text-xs font-normal text-muted-foreground">개 파이프라인</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            평균 실행 시간: <span className="font-semibold text-foreground">1m 32s</span>
          </div>
        </Card>

        <Card className="p-4 space-y-1.5 bg-card/80 border-border/80 shadow-xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>자율화 정책 (Autonomy Mode)</span>
            <Badge variant="outline" className="text-[9px] px-1 py-0 uppercase">Policy</Badge>
          </div>
          <div className="text-2xl md:text-3xl font-extrabold font-mono tracking-tight text-emerald-600 dark:text-emerald-400">
            GUARDED_AUTO
          </div>
          <div className="text-[11px] text-muted-foreground">
            고위험 작업: <span className="font-semibold text-foreground">사전 미리보기 승인</span>
          </div>
        </Card>

        <Card className="p-4 space-y-1.5 bg-card/80 border-border/80 shadow-xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>MCP 도구 호출 성공률</span>
            <Badge variant="outline" className="text-[9px] px-1 py-0">Telemetry</Badge>
          </div>
          <div className="text-xl md:text-2xl font-extrabold font-mono tracking-tight text-foreground">
            {runs.length > 0 ? '100.0%' : 'NO DATA'}
          </div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="size-3" /> Gemini 3.8 / 릴스 / CRM 도구 연동
          </div>
        </Card>

        <Card className="p-4 space-y-1.5 bg-card/80 border-border/80 shadow-xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>정산 Agent Energy</span>
            <Badge variant="outline" className="text-[9px] px-1 py-0">Energy</Badge>
          </div>
          <div className="text-xl md:text-2xl font-extrabold font-mono tracking-tight text-foreground flex items-center gap-1">
            <Zap className="size-5 text-amber-500" /> {runs.length > 0 ? runs.length * 10 : 0}
            <span className="text-xs font-normal text-muted-foreground">Energy</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Agent Energy FinOps 단일 원장
          </div>
        </Card>
      </div>

      {/* 3. Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-5 max-w-2xl bg-muted/40 p-1">
          <TabsTrigger value="runs" className="text-xs font-semibold">실시간 런 (Live Runs)</TabsTrigger>
          <TabsTrigger value="exceptions" className="text-xs font-semibold">예외 및 대사 큐</TabsTrigger>
          <TabsTrigger value="inspector" className="text-xs font-semibold">감사 인스펙터</TabsTrigger>
          <TabsTrigger value="missions" className="text-xs font-semibold">80 성장 미션 (Missions)</TabsTrigger>
          <TabsTrigger value="capabilities" className="text-xs font-semibold">18대 MCP Registry</TabsTrigger>
        </TabsList>

        {/* Tab 1: Live Runs */}
        <TabsContent value="runs" className="space-y-4">
          <Card className="p-0 overflow-hidden shadow-xs border border-border/80">
            <CardHeader className="p-4 bg-muted/20 border-b flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Activity className="size-4 text-primary" /> 실시간 에이전트 액션 런 (Action Runs)
                </CardTitle>
                <CardDescription className="text-xs">
                  소희 대화형 커맨드 플레인과 백그라운드 미션에서 생성된 ActionGraph 파이프라인
                </CardDescription>
              </div>
              <Badge variant="outline" className="font-mono text-xs">{runs.length}개 활성</Badge>
            </CardHeader>
            <CardContent className="p-0">
              {runs.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground flex flex-col items-center justify-center gap-2">
                  <Activity className="size-8 stroke-[1.5] text-muted-foreground/60" />
                  <p className="text-sm font-medium">현재 실행 중이거나 대기 중인 에이전트 작업이 없습니다.</p>
                  <p className="text-xs text-muted-foreground/80">소희 대화형 에이전트 및 백그라운드 마케팅 미션 가동 시 실시간으로 파이프라인이 생성됩니다.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="w-[110px]">런 ID</TableHead>
                      <TableHead>미션 / 사용자 의도</TableHead>
                      <TableHead>고객사</TableHead>
                      <TableHead>액션 유형</TableHead>
                      <TableHead>위험 등급</TableHead>
                      <TableHead className="w-[140px]">진행 단계</TableHead>
                      <TableHead>예약 SC</TableHead>
                      <TableHead>상태</TableHead>
                      <TableHead className="text-right">조치</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                  {runs.map((r) => (
                    <TableRow key={r.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-mono text-xs font-bold text-primary">{r.id}</TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <p className="text-xs font-bold text-foreground">{r.mission}</p>
                          <p className="text-[11px] text-muted-foreground line-clamp-1">{r.intent}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-semibold">{r.workspace}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{r.action}</TableCell>
                      <TableCell>
                        <Badge variant={r.risk === "HIGH" ? "destructive" : r.risk === "MEDIUM" ? "warning" : "default"} className="text-[10px] font-semibold">
                          {r.risk}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                            <span>{r.progress}%</span>
                            <span>{r.elapsed}</span>
                          </div>
                          <Progress value={r.progress} max={100} className="h-1.5" />
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-amber-600 dark:text-amber-400 font-bold">{r.reservedSc} SC</TableCell>
                      <TableCell>
                        <Badge
                          variant={r.status === "VERIFIED" || r.status === "SETTLED" ? "success" : r.status === "VERIFICATION_PENDING" ? "warning" : "info"}
                          className="text-[10px] font-semibold"
                        >
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedRun(r)}
                          className="h-7 text-xs px-2.5 font-medium hover:bg-primary hover:text-primary-foreground"
                        >
                          ActionGraph
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Exception Reconcile Queue */}
        <TabsContent value="exceptions" className="space-y-4">
          <ExceptionReconcileQueue />
        </TabsContent>

        {/* Tab 3: ActionRun Inspector */}
        <TabsContent value="inspector" className="space-y-4">
          <ActionRunInspector />
        </TabsContent>

        {/* Tab 4: 80 Missions */}
        <TabsContent value="missions" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              {["ALL", "GROWTH", "SEO", "CRM", "ACQUISITION"].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    selectedCategory === cat
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "bg-muted/60 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <Input
                placeholder="미션 이름, ID 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredMissions.map((m) => (
              <Card key={m.id} className="p-4 space-y-3 border-border/80 shadow-xs hover:border-primary/40 transition-colors bg-card/80">
                <div className="flex items-start justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px] font-mono">{m.id}</Badge>
                      <Badge variant="purple" className="text-[10px] font-semibold">{m.category}</Badge>
                    </div>
                    <h3 className="font-bold text-sm text-foreground pt-1">{m.title}</h3>
                  </div>
                  <Badge variant="success" className="text-[10px]">{m.status}</Badge>
                </div>

                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                  {m.desc}
                </p>

                <div className="pt-2 border-t grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="p-2 rounded bg-muted/40">
                    <span className="text-[10px] text-muted-foreground">성공률</span>
                    <p className="font-mono font-bold text-emerald-600 mt-0.5">{m.successRate}</p>
                  </div>
                  <div className="p-2 rounded bg-muted/40">
                    <span className="text-[10px] text-muted-foreground">평균 소모</span>
                    <p className="font-mono font-bold text-amber-600 mt-0.5">{m.avgSc} SC</p>
                  </div>
                  <div className="p-2 rounded bg-muted/40">
                    <span className="text-[10px] text-muted-foreground">적용사</span>
                    <p className="font-mono font-bold text-foreground mt-0.5">{m.activeWorkspaces}개사</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Tab 3: 18 MCP Registry */}
        <TabsContent value="capabilities" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {mcpTools.map((tool) => (
              <Card key={tool.name} className="p-4 space-y-2.5 border-border/80 shadow-xs hover:border-primary/40 transition-colors bg-card/80">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-[10px] uppercase font-mono">{tool.category}</Badge>
                  <span className="text-[10px] font-mono text-emerald-600 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="size-3" /> {tool.success}
                  </span>
                </div>
                <div>
                  <h4 className="font-mono text-xs font-bold text-primary break-all">{tool.name}</h4>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{tool.desc}</p>
                </div>
                <div className="pt-2 border-t flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                  <span>응답: <b className="text-foreground">{tool.latency}</b></span>
                  <span>단가: <b className="text-amber-600">{tool.cost}</b></span>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* ActionGraph Modal */}
      {selectedRun && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl shadow-2xl border-border bg-card animate-in fade-in zoom-in-95 duration-200">
            <CardHeader className="border-b pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="purple" className="text-xs">{selectedRun.id}</Badge>
                  <CardTitle className="text-base font-bold">ActionGraph 실행 추적</CardTitle>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setSelectedRun(null)} className="size-8 p-0 rounded-full">
                  <X className="size-4" />
                </Button>
              </div>
              <CardDescription className="text-xs font-mono mt-1">
                {selectedRun.mission} ({selectedRun.workspace})
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 space-y-4 text-xs">
              {/* Visual Pipeline Graph */}
              <div className="p-4 rounded-xl bg-muted/40 border space-y-3">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <Sparkles className="size-4 text-primary" /> 파이프라인 그래프 (Pipeline Flow)
                </span>
                <div className="flex items-center justify-between gap-2 overflow-x-auto py-2">
                  <div className="p-2.5 rounded-lg bg-background border text-center flex-1 min-w-[100px]">
                    <span className="text-[10px] text-muted-foreground font-mono">1. Intent</span>
                    <p className="font-bold text-emerald-600 text-xs mt-0.5">분석 완료</p>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground shrink-0" />
                  <div className="p-2.5 rounded-lg bg-background border text-center flex-1 min-w-[100px]">
                    <span className="text-[10px] text-muted-foreground font-mono">2. Reserve SC</span>
                    <p className="font-bold text-amber-600 text-xs mt-0.5">350 SC 예약</p>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground shrink-0" />
                  <div className="p-2.5 rounded-lg bg-background border text-center flex-1 min-w-[100px]">
                    <span className="text-[10px] text-muted-foreground font-mono">3. MCP Execute</span>
                    <p className="font-bold text-purple-600 text-xs mt-0.5">발행 완료</p>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground shrink-0" />
                  <div className="p-2.5 rounded-lg bg-purple-500/10 border border-purple-500/30 text-center flex-1 min-w-[100px]">
                    <span className="text-[10px] text-purple-600 font-mono font-bold">4. Read-Verify</span>
                    <p className="font-bold text-purple-600 text-xs mt-0.5">대사 중 (85%)</p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <span className="font-semibold text-foreground">호출된 MCP 도구 목록</span>
                <div className="flex flex-wrap gap-1.5">
                  {selectedRun.toolsUsed.map((t: string) => (
                    <Badge key={t} variant="outline" className="font-mono text-xs bg-muted/60">{t}</Badge>
                  ))}
                </div>
              </div>
            </CardContent>
            <div className="p-4 border-t bg-muted/20 flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelectedRun(null)} className="h-8 text-xs">
                닫기
              </Button>
              <Button size="sm" onClick={() => setSelectedRun(null)} className="h-8 text-xs font-semibold">
                검증 강제 승인
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

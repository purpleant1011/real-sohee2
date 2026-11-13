"use client"

import React, { useState } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table"
import {
  ShieldCheck, Lock, AlertTriangle, RefreshCw, KeyRound, Globe,
  Camera, CheckCircle2, XCircle, Clock, Sparkles
} from "lucide-react"

export interface WorkspaceAuthTabProps {
  workspaceId: string
  initialAuthorizations?: Array<{
    id: string
    provider: string
    status: string
    accountLabel: string
    authorizedAt: string
    capabilities: string[]
  }>
  trialInfo?: {
    status: string
    startsAt: string
    endsAt: string
    initialCredit: number
  } | null
}

export function WorkspaceAuthorizationsTab({
  workspaceId,
  initialAuthorizations = [],
  trialInfo,
}: WorkspaceAuthTabProps) {
  const [authList, setAuthList] = useState(initialAuthorizations)
  const [isProcessing, setIsProcessing] = useState(false)

  const handleRevoke = (authId: string) => {
    setAuthList((prev) =>
      prev.map((item) => (item.id === authId ? { ...item, status: "REVOKED" } : item))
    )
  }

  return (
    <div className="space-y-6">
      {/* 1. Trial Entitlement Card */}
      {trialInfo && (
        <Card className="border-border/80 bg-gradient-to-r from-purple-500/5 via-primary/5 to-card shadow-xs">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-purple-600 dark:text-purple-400" />
                <CardTitle className="text-sm font-bold">14일 무료체험 (Trial Entitlement) 상태</CardTitle>
              </div>
              <Badge variant={trialInfo.status === "ACTIVE" ? "success" : "outline"} className="text-[10px]">
                {trialInfo.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="text-xs space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg bg-card/60 border">
              <div>
                <span className="text-muted-foreground">지급 크레딧:</span>
                <p className="font-bold text-primary mt-0.5">{trialInfo.initialCredit} SC</p>
              </div>
              <div>
                <span className="text-muted-foreground">시작일:</span>
                <p className="font-mono mt-0.5">{trialInfo.startsAt.slice(0, 10)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">만료 예정일:</span>
                <p className="font-mono mt-0.5">{trialInfo.endsAt.slice(0, 10)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">만료 시 정산:</span>
                <p className="text-emerald-600 font-semibold mt-0.5">TRIAL_EXPIRATION 원장</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 2. Channel Authorizations & Capabilities */}
      <Card className="p-0 overflow-hidden shadow-xs border border-border/80">
        <CardHeader className="p-4 bg-muted/20 border-b flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <KeyRound className="size-4 text-primary" /> 채널 인가 및 실행 권한 목록 (Channel Authorizations)
            </CardTitle>
            <CardDescription className="text-xs">
              고객사가 소희에게 위임한 SNS/커넥터 인가 토큰 및 세부 기능(Capability) 허용 상태
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead>채널 공급자</TableHead>
                <TableHead>계정 / 세션 라벨</TableHead>
                <TableHead>인가 상태</TableHead>
                <TableHead>부여된 권한 (Capabilities)</TableHead>
                <TableHead>인가 일시</TableHead>
                <TableHead className="text-right">운영자 조치</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {authList.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-xs">
                    연결된 채널 인가 내역이 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                authList.map((auth) => (
                  <TableRow key={auth.id} className="hover:bg-muted/30">
                    <TableCell className="font-semibold text-xs flex items-center gap-2">
                      {auth.provider.includes("META") ? (
                        <Camera className="size-4 text-pink-600" />
                      ) : (
                        <Globe className="size-4 text-emerald-600" />
                      )}
                      {auth.provider}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{auth.accountLabel || "-"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={auth.status === "CONNECTED" ? "success" : "destructive"}
                        className="text-[10px] font-semibold"
                      >
                        {auth.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {auth.capabilities.map((cap) => (
                          <Badge key={cap} variant="outline" className="text-[9px] font-mono">
                            {cap}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{auth.authorizedAt.slice(0, 10)}</TableCell>
                    <TableCell className="text-right">
                      {auth.status === "CONNECTED" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRevoke(auth.id)}
                          className="h-7 text-xs px-2.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                        >
                          인가 강제 철회
                        </Button>
                      )}
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

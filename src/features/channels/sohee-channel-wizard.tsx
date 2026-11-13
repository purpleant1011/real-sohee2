"use client"

import React, { useState } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ShieldCheck, ArrowRight, CheckCircle2, Lock, Camera, Globe,
  Sparkles, RefreshCw
} from "lucide-react"

export interface SoheeChannelWizardProps {
  workspaceId: string
  onComplete?: () => void
}

export function SoheeChannelWizard({ workspaceId, onComplete }: SoheeChannelWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [agreedTerms, setAgreedTerms] = useState(false)
  const [agreedDelegation, setAgreedDelegation] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<string | null>("META_INSTAGRAM")

  const [capabilities, setCapabilities] = useState({
    publishFeed: true,
    publishReels: true,
    publishStory: true,
    autoReplyComments: false,
  })

  const [isProcessing, setIsProcessing] = useState(false)

  const handleStep1Submit = () => {
    if (!agreedTerms || !agreedDelegation) return
    setStep(2)
  }

  const handleStep2Connect = () => {
    setIsProcessing(true)
    setTimeout(() => {
      setIsProcessing(false)
      setStep(3)
    }, 800)
  }

  const handleStep3Finish = () => {
    if (onComplete) onComplete()
  }

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* Step Stepper Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-muted/30 rounded-xl border border-border/60">
        <div className="flex items-center gap-2">
          <div className={`size-7 rounded-full flex items-center justify-center text-xs font-bold ${
            step >= 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          }`}>
            1
          </div>
          <span className={`text-xs font-semibold ${step >= 1 ? "text-foreground" : "text-muted-foreground"}`}>
            위임 동의
          </span>
        </div>
        <div className="h-0.5 w-12 bg-border" />
        <div className="flex items-center gap-2">
          <div className={`size-7 rounded-full flex items-center justify-center text-xs font-bold ${
            step >= 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          }`}>
            2
          </div>
          <span className={`text-xs font-semibold ${step >= 2 ? "text-foreground" : "text-muted-foreground"}`}>
            채널 연동
          </span>
        </div>
        <div className="h-0.5 w-12 bg-border" />
        <div className="flex items-center gap-2">
          <div className={`size-7 rounded-full flex items-center justify-center text-xs font-bold ${
            step >= 3 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          }`}>
            3
          </div>
          <span className={`text-xs font-semibold ${step >= 3 ? "text-foreground" : "text-muted-foreground"}`}>
            권한 세분화
          </span>
        </div>
      </div>

      {/* Step 1: Legal & Delegation Consent */}
      {step === 1 && (
        <Card className="shadow-xs border-border/80">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary font-bold text-sm">
              <ShieldCheck className="size-4" /> 1단계: 마케팅 업무 위임 및 이용 동의
            </div>
            <CardTitle className="text-xl">소희 AI에게 마케팅 업무를 안전하게 위임합니다</CardTitle>
            <CardDescription className="text-xs">
              소희는 승인된 범위 내에서만 자율적으로 콘텐츠를 발행하며, 모든 활동은 동의 확인서로 안전하게 기록됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-xs">
            <div className="p-4 rounded-lg bg-muted/40 space-y-3 border">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedTerms}
                  onChange={(e) => setAgreedTerms(e.target.checked)}
                  className="mt-0.5 size-4 rounded border-border"
                />
                <div>
                  <span className="font-bold text-foreground">[필수] 소희 서비스 이용약관 및 개인정보 처리방침 동의</span>
                  <p className="text-muted-foreground mt-0.5">회원사 데이터 보호 및 안전한 공식 연결 규정을 준수합니다.</p>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer pt-2 border-t border-border/40">
                <input
                  type="checkbox"
                  checked={agreedDelegation}
                  onChange={(e) => setAgreedDelegation(e.target.checked)}
                  className="mt-0.5 size-4 rounded border-border"
                />
                <div>
                  <span className="font-bold text-foreground">[필수] SNS/채널 마케팅 콘텐츠 생성 및 게시 권한 위임</span>
                  <p className="text-muted-foreground mt-0.5">대표자 승인 후 인가된 SNS 계정에 최종 콘텐츠를 게시합니다.</p>
                </div>
              </label>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end border-t pt-4">
            <Button
              disabled={!agreedTerms || !agreedDelegation}
              onClick={handleStep1Submit}
              className="gap-2 text-xs font-semibold"
            >
              다음: 채널 연결하기 <ArrowRight className="size-3.5" />
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Step 2: Channel Connection */}
      {step === 2 && (
        <Card className="shadow-xs border-border/80">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary font-bold text-sm">
              <Lock className="size-4" /> 2단계: 연동할 마케팅 채널 선택
            </div>
            <CardTitle className="text-xl">소희가 관리할 채널을 인가해주세요</CardTitle>
            <CardDescription className="text-xs">
              소희 공식 앱을 통한 공식 계정 로그인으로 안전하게 연결되며, 비밀번호는 절대 저장되지 않습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              onClick={() => setSelectedProvider("META_INSTAGRAM")}
              className={`p-4 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                selectedProvider === "META_INSTAGRAM"
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:bg-muted/30"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-pink-500/10 text-pink-600">
                  <Camera className="size-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm">Instagram / Threads (Meta 공식)</span>
                    <Badge variant="outline" className="text-[10px] text-pink-600 border-pink-500/30">공식 계정 로그인</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">비즈니스 계정 피드 및 릴스 게시</p>
                </div>
              </div>
              <CheckCircle2 className={`size-5 ${selectedProvider === "META_INSTAGRAM" ? "text-primary" : "text-muted-foreground/30"}`} />
            </div>

            <div
              onClick={() => setSelectedProvider("NAVER_BROWSER")}
              className={`p-4 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                selectedProvider === "NAVER_BROWSER"
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:bg-muted/30"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-600">
                  <Globe className="size-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm">네이버 플레이스 / 블로그</span>
                    <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">브라우저 연결 도구</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">플레이스 리뷰 답글 및 블로그 원고·사진 준비</p>
                </div>
              </div>
              <CheckCircle2 className={`size-5 ${selectedProvider === "NAVER_BROWSER" ? "text-primary" : "text-muted-foreground/30"}`} />
            </div>
          </CardContent>
          <CardFooter className="flex justify-between border-t pt-4">
            <Button variant="outline" size="sm" onClick={() => setStep(1)} className="text-xs">
              이전
            </Button>
            <Button
              disabled={!selectedProvider || isProcessing}
              onClick={handleStep2Connect}
              className="gap-2 text-xs font-semibold"
            >
              {isProcessing && <RefreshCw className="size-3.5 animate-spin" />}
              {selectedProvider === "META_INSTAGRAM" ? "Meta 공식 로그인 연동" : "연결 도구로 연결"}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Step 3: Granular Capabilities Grant */}
      {step === 3 && (
        <Card className="shadow-xs border-border/80">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary font-bold text-sm">
              <Sparkles className="size-4" /> 3단계: 소희의 실행 권한 세분화
            </div>
            <CardTitle className="text-xl">소희가 실행할 수 있는 행동을 선택하세요</CardTitle>
            <CardDescription className="text-xs">
              언제든지 관리자 페이지 또는 나의 소희 메뉴에서 권한을 켜고 끌 수 있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="p-4 rounded-xl border bg-card space-y-3.5">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <span className="font-bold text-foreground">인스타그램 피드 카드뉴스 발행</span>
                  <p className="text-muted-foreground mt-0.5">AI 생성 이미지와 카피라이팅으로 피드 게시</p>
                </div>
                <input
                  type="checkbox"
                  checked={capabilities.publishFeed}
                  onChange={(e) => setCapabilities({ ...capabilities, publishFeed: e.target.checked })}
                  className="size-4 rounded border-border"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer pt-3 border-t border-border/40">
                <div>
                  <span className="font-bold text-foreground">인스타그램 릴스(Reels) 영상 발행</span>
                  <p className="text-muted-foreground mt-0.5">숏폼 비디오 콘텐츠 자율 게시</p>
                </div>
                <input
                  type="checkbox"
                  checked={capabilities.publishReels}
                  onChange={(e) => setCapabilities({ ...capabilities, publishReels: e.target.checked })}
                  className="size-4 rounded border-border"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer pt-3 border-t border-border/40">
                <div>
                  <span className="font-bold text-foreground">댓글 및 DM 답변 초안 준비 (고객 응대)</span>
                  <p className="text-muted-foreground mt-0.5">문의 댓글 및 DM 발생 시 사장님 검토용 답변 초안 작성</p>
                </div>
                <input
                  type="checkbox"
                  checked={capabilities.autoReplyComments}
                  onChange={(e) => setCapabilities({ ...capabilities, autoReplyComments: e.target.checked })}
                  className="size-4 rounded border-border"
                />
              </label>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between border-t pt-4">
            <Button variant="outline" size="sm" onClick={() => setStep(2)} className="text-xs">
              이전
            </Button>
            <Button onClick={handleStep3Finish} className="gap-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white">
              <CheckCircle2 className="size-3.5" /> 연동 완료 및 마케팅 시작
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  )
}

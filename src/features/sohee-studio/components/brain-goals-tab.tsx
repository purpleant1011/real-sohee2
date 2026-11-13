'use client'

import React, { useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle,
  Edit2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import type { SoheeGoal } from '../types'

interface BrainGoalsTabProps {
  workspaceId: string
  onTellGoal: () => void
  onRefreshTrigger?: number
}

export function BrainGoalsTab({
  workspaceId,
  onTellGoal,
  onRefreshTrigger = 0,
}: BrainGoalsTabProps) {
  const [goals, setGoals] = useState<SoheeGoal[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editOutcome, setEditOutcome] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const fetchGoals = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/sohee-studio/goals`)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const json = await res.json().catch(() => ({}))
      if (json.success && Array.isArray(json.data)) {
        setGoals(json.data)
      } else {
        throw new Error(json.message || '목표 목록 조회 실패')
      }
    } catch (err: any) {
      console.error('Failed to fetch goals:', err)
      setError('목표 목록을 불러오지 못했습니다.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void fetchGoals()
  }, [workspaceId, onRefreshTrigger])

  const handleToggleStatus = async (goal: SoheeGoal) => {
    setIsUpdating(true)
    setActionError(null)
    const nextStatus = goal.status === 'active' ? 'paused' : 'active'

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/sohee-studio/goals/${goal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: goal.version,
          status: nextStatus,
        }),
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const json = await res.json().catch(() => ({}))
      if (!json.success || !json.data) {
        throw new Error(json.message || '상태 변경 실패')
      }

      setGoals((prev) => prev.map((g) => (g.id === goal.id ? json.data : g)))
    } catch (err: any) {
      console.error('Failed to toggle goal status:', err)
      setActionError('목표 상태 변경에 실패했습니다. 최신 버전을 확인 후 다시 시도해 주세요.')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleStartEdit = (goal: SoheeGoal) => {
    setEditingGoalId(goal.id)
    setEditTitle(goal.title)
    setEditOutcome(goal.desiredOutcome || '')
    setActionError(null)
  }

  const handleSaveEdit = async (goal: SoheeGoal) => {
    if (!editTitle.trim()) return
    setIsUpdating(true)
    setActionError(null)

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/sohee-studio/goals/${goal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: goal.version,
          title: editTitle.trim(),
          desiredOutcome: editOutcome.trim(),
        }),
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const json = await res.json().catch(() => ({}))
      if (!json.success || !json.data) {
        throw new Error(json.message || '수정 실패')
      }

      setGoals((prev) => prev.map((g) => (g.id === goal.id ? json.data : g)))
      setEditingGoalId(null)
    } catch (err: any) {
      console.error('Failed to update goal:', err)
      setActionError('목표 수정에 실패했습니다. (동시 수정 충돌 시 새로고침 후 다시 시도해주세요)')
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 text-xs text-indigo-800 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-300 flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Target className="size-4 shrink-0 mt-0.5 text-indigo-600 dark:text-indigo-400" />
          <div className="space-y-0.5">
            <p className="font-bold">소희의 목표 지령판</p>
            <p className="text-[11px] text-indigo-700/90 dark:text-indigo-400/90">
              소희가 마케팅과 콘텐츠를 기획할 때 최우선으로 고려하는 사장님의 사업 목표입니다.
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={onTellGoal}
          className="h-7 text-xs px-2.5 bg-indigo-600 hover:bg-indigo-700 text-white shrink-0"
        >
          <Plus className="size-3 mr-1" />
          새 목표 말하기
        </Button>
      </div>

      {actionError && (
        <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 p-2.5 rounded-xl border border-destructive/20">
          <AlertCircle className="size-3.5 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      ) : error ? (
        <Card className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-3">
          <AlertCircle className="size-8 mx-auto text-destructive" />
          <p className="text-xs font-semibold text-destructive">{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void fetchGoals()}
            className="text-xs"
          >
            <RefreshCw className="size-3 mr-1" />
            다시 시도
          </Button>
        </Card>
      ) : goals.length === 0 ? (
        <Card className="rounded-xl border border-dashed p-6 text-center space-y-2">
          <Target className="size-8 mx-auto text-muted-foreground/60" />
          <p className="text-xs font-semibold text-foreground">
            아직 설정된 목표가 없어요.
          </p>
          <p className="text-[11px] text-muted-foreground">
            &ldquo;단골 고객 재방문 늘리기&rdquo;, &ldquo;신규 서비스 인지도 높이기&rdquo;처럼 대화창에 사장님의 목표를 말씀해주세요!
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onTellGoal}
            className="text-xs mt-2"
          >
            대화창에 목표 알려주기
          </Button>
        </Card>
      ) : (
        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
          {goals.map((goal) => {
            const isEditingThis = editingGoalId === goal.id

            return (
              <Card
                key={goal.id}
                className="rounded-xl border border-border p-4 space-y-3 bg-card/60 hover:border-indigo-300 dark:hover:border-indigo-800 transition-all"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="text-[10px] border-indigo-300 text-indigo-700 bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:bg-indigo-950/40"
                      >
                        우선순위: {goal.priority === 'high' ? '높음' : '보통'}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">버전 {goal.version}</span>
                    </div>

                    {isEditingThis ? (
                      <div className="space-y-2 pt-1">
                        <Input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          placeholder="목표 제목"
                          className="text-xs bg-background h-8"
                          autoFocus
                        />
                        <Input
                          value={editOutcome}
                          onChange={(e) => setEditOutcome(e.target.value)}
                          placeholder="기대하는 모습 (선택)"
                          className="text-xs bg-background h-8"
                        />
                        <div className="flex items-center gap-1.5 pt-1">
                          <Button
                            type="button"
                            size="sm"
                            disabled={isUpdating || !editTitle.trim()}
                            onClick={() => void handleSaveEdit(goal)}
                            className="h-6 text-[10px] px-2 bg-indigo-600 hover:bg-indigo-700 text-white"
                          >
                            저장
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={isUpdating}
                            onClick={() => setEditingGoalId(null)}
                            className="h-6 text-[10px] px-2 text-muted-foreground"
                          >
                            취소
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <h4 className="text-xs font-bold text-foreground pt-0.5">
                        {goal.title}
                      </h4>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-semibold ${
                        goal.status === 'active'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      <CheckCircle className="size-3" />
                      {goal.status === 'active' ? '달성 진행 중' : '일시중지됨'}
                    </span>
                  </div>
                </div>

                {!isEditingThis && goal.desiredOutcome && (
                  <div className="rounded-lg bg-muted/40 p-2 text-[11px] text-muted-foreground border border-border/40">
                    <span className="font-semibold text-foreground">기대하는 모습: </span>
                    {goal.desiredOutcome}
                  </div>
                )}

                <div className="flex items-center justify-between pt-1 border-t border-border/50 text-[10px] text-muted-foreground">
                  <span>목표는 소희의 기획에 반영되며 자동 실행되지 않습니다.</span>
                  <div className="flex items-center gap-1">
                    {!isEditingThis && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStartEdit(goal)}
                        disabled={isUpdating}
                        className="h-6 text-[10px] px-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <Edit2 className="size-3 mr-0.5" />
                        수정
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleToggleStatus(goal)}
                      disabled={isUpdating}
                      className="h-6 text-[10px] px-1.5 text-muted-foreground hover:text-foreground"
                    >
                      {goal.status === 'active' ? (
                        <>
                          <Pause className="size-3 mr-0.5" />
                          일시중지
                        </>
                      ) : (
                        <>
                          <Play className="size-3 mr-0.5" />
                          다시 시작
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

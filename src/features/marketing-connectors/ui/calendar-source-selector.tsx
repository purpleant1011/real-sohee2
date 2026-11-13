'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

export interface CalendarSource {
  readonly id: string;
  readonly summary: string;
  readonly primary: boolean;
  readonly timeZone: string;
}

export interface CalendarSourceSelectorProps {
  readonly workspaceId: string;
  readonly initialCalendars?: readonly CalendarSource[];
  readonly initialSelectedIds?: readonly string[];
  readonly onSave?: (
    selectedIds: string[],
    aiProcessingApproved: boolean
  ) => void | Promise<void>;
  readonly onCancel?: () => void;
  readonly isSaving?: boolean;
}

export function CalendarSourceSelector({
  workspaceId,
  initialCalendars,
  initialSelectedIds,
  onSave,
  onCancel,
  isSaving = false,
}: CalendarSourceSelectorProps): React.ReactElement {
  const [calendars, setCalendars] = useState<readonly CalendarSource[]>(
    initialCalendars ?? []
  );
  const [loading, setLoading] = useState<boolean>(!initialCalendars);
  const [error, setError] = useState<string | null>(null);

  // 사장님의 명시적 선택을 존중하며 기본 캘린더(primary)를 자동 선택하지 않음
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialSelectedIds ?? [])
  );
  const [aiProcessingApproved, setAiProcessingApproved] =
    useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const loadCalendars = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/marketing-connectors/google/calendars`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const detail = data?.message ? `: ${data.message}` : '';
        throw new Error(
          `캘린더 목록을 불러오지 못했습니다${detail}. 다시 시도해 주세요.`
        );
      }
      const data = await res.json();
      const list = Array.isArray(data.calendars) ? data.calendars : [];
      setCalendars(list);
    } catch (err: any) {
      setError(
        err.message ||
          '캘린더 목록을 불러오지 못했습니다. 다시 시도해 주세요.'
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    let ignore = false;
    if (!initialCalendars && workspaceId) {
      fetch(`/api/workspaces/${workspaceId}/marketing-connectors/google/calendars`)
        .then(async (res) => {
          if (!res.ok) {
            const data = await res.json().catch(() => null);
            const detail = data?.message ? `: ${data.message}` : '';
            throw new Error(
              `캘린더 목록을 불러오지 못했습니다${detail}. 다시 시도해 주세요.`
            );
          }
          return res.json();
        })
        .then((data) => {
          if (!ignore) {
            const list = Array.isArray(data.calendars) ? data.calendars : [];
            setCalendars(list);
            setLoading(false);
          }
        })
        .catch((err: any) => {
          if (!ignore) {
            setError(
              err.message ||
                '캘린더 목록을 불러오지 못했습니다. 다시 시도해 주세요.'
            );
            setLoading(false);
          }
        });
    }

    return () => {
      ignore = true;
    };
  }, [initialCalendars, workspaceId]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleToggleSelectAll = useCallback(() => {
    if (selectedIds.size === calendars.length && calendars.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(calendars.map((c) => c.id)));
    }
  }, [calendars, selectedIds.size]);

  const isAllSelected = useMemo(
    () => calendars.length > 0 && selectedIds.size === calendars.length,
    [calendars.length, selectedIds.size]
  );

  const handleSave = async () => {
    if (selectedIds.size === 0 || !aiProcessingApproved) return;
    setSubmitting(true);
    setError(null);

    const idsArray = Array.from(selectedIds);
    try {
      if (onSave) {
        await onSave(idsArray, aiProcessingApproved);
      } else {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/marketing-connectors/google/calendars`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              selectedCalendarIds: idsArray,
              aiProcessingApproved,
            }),
          }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(
            data?.message || '선택한 캘린더 설정을 저장하지 못했습니다.'
          );
        }
      }
    } catch (err: any) {
      setError(err.message || '저장하는 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedCount = selectedIds.size;
  const busy = loading || isSaving || submitting;

  return (
    <div className="w-full max-w-lg mx-auto p-4 sm:p-6 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Google 캘린더 연동 범위 선택
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          마케팅 일정 분석 및 포스팅 추천에 활용할 사업 캘린더를 선택해 주세요.
        </p>
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>오류 안내</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div
          className="flex flex-col items-center justify-center py-12 text-zinc-500 gap-2"
          role="status"
          aria-live="polite"
        >
          <div className="w-6 h-6 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
          <p className="text-sm">캘린더 목록을 불러오는 중입니다...</p>
        </div>
      ) : calendars.length === 0 ? (
        <div className="py-8 text-center text-sm text-zinc-500">
          연동 가능한 캘린더를 찾을 수 없습니다.
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={loadCalendars}
            >
              다시 시도
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2">
            <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={handleToggleSelectAll}
                className="w-4 h-4 rounded border-zinc-300 text-primary focus:ring-primary cursor-pointer"
                aria-label="전체 캘린더 선택"
              />
              <span>전체 선택</span>
            </label>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
              {selectedCount}개 선택됨
            </span>
          </div>

          <div
            className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1"
            role="list"
            aria-label="Google 캘린더 목록"
          >
            {calendars.map((cal) => {
              const isSelected = selectedIds.has(cal.id);
              const title = cal.summary || '이름 없는 캘린더';

              return (
                <div
                  key={cal.id}
                  onClick={() => handleToggleSelect(cal.id)}
                  role="listitem"
                  className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer select-none ${
                    isSelected
                      ? 'border-primary/50 bg-primary/5 dark:bg-primary/10'
                      : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => handleToggleSelect(cal.id)}
                    className="mt-0.5 w-4 h-4 rounded border-zinc-300 text-primary focus:ring-primary cursor-pointer"
                    aria-label={`${title} 선택`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {title}
                      </span>
                      {cal.primary && (
                        <Badge variant="secondary" className="text-xs">
                          기본 캘린더
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                      {cal.timeZone}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-zinc-50 dark:bg-zinc-800/40 rounded-lg p-3.5 border border-zinc-200/70 dark:border-zinc-800 flex flex-col gap-2">
            <label className="flex items-start gap-2.5 cursor-pointer text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={aiProcessingApproved}
                onChange={(e) => setAiProcessingApproved(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-zinc-300 text-primary focus:ring-primary cursor-pointer"
                aria-label="마케팅 일정 반영 및 AI 처리 동의"
              />
              <span className="font-medium">
                선택한 캘린더의 일정을 소희 AI 마케팅 분석 및 제안에 활용하는 것에 동의합니다.
              </span>
            </label>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 pl-6 leading-relaxed">
              소희 AI는 선택하신 캘린더의 일정명과 시간 정보만 안전하게 참조하며, 참석자나 개인적인 메모 등의 민감한 정보는 절대 수집하지 않습니다. 동의는 언제든지 변경하거나 철회할 수 있습니다.
            </p>
          </div>
        </>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={busy}
          >
            취소
          </Button>
        )}
        <Button
          type="button"
          variant="default"
          onClick={handleSave}
          disabled={busy || selectedCount === 0 || !aiProcessingApproved}
          aria-label="캘린더 선택 완료"
        >
          {busy
            ? '저장 중...'
            : selectedCount === 0
            ? '캘린더를 선택하세요'
            : `${selectedCount}개 캘린더 저장`}
        </Button>
      </div>
    </div>
  );
}

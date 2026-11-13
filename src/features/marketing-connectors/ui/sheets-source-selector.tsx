'use client';

import React, { useState, useId, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { extractGoogleSpreadsheetId } from '../adapters/google-sheets';

export interface SheetsSourceSelectorProps {
  readonly workspaceId: string;
  readonly initialSpreadsheetId?: string;
  readonly initialSheetName?: string;
  readonly initialRange?: string;
  readonly onSave?: (sourceId: string, aiProcessingApproved: boolean) => void | Promise<void>;
  readonly onCancel?: () => void;
  readonly isSaving?: boolean;
}

const PRESET_RANGES = ['A1:D50', 'A1:Z100', 'A1:F30'] as const;

// A1 표기법 정규식: A1:D50, Sheet1!A1:B10 등
const A1_RANGE_REGEX = /^(?:'?[^!]+'?! *)?[A-Za-z]+[0-9]*:[A-Za-z]+[0-9]*$/;

export function SheetsSourceSelector({
  workspaceId,
  initialSpreadsheetId = '',
  initialSheetName = '시트1',
  initialRange = 'A1:D50',
  onSave,
  onCancel,
  isSaving = false,
}: SheetsSourceSelectorProps): React.ReactElement {
  const [spreadsheetInput, setSpreadsheetInput] = useState<string>(initialSpreadsheetId);
  const [sheetName, setSheetName] = useState<string>(initialSheetName);
  const [rangeInput, setRangeInput] = useState<string>(initialRange);
  const [aiProcessingApproved, setAiProcessingApproved] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const spreadsheetInputId = useId();
  const sheetNameInputId = useId();
  const rangeInputId = useId();
  const consentCheckboxId = useId();

  // 추출된 유효한 spreadsheetId
  const extractedSpreadsheetId = useMemo(() => {
    return extractGoogleSpreadsheetId(spreadsheetInput);
  }, [spreadsheetInput]);

  // A1 범위 유효성 검사
  const isRangeValid = useMemo(() => {
    const trimmed = rangeInput.trim();
    if (!trimmed) return false;
    return A1_RANGE_REGEX.test(trimmed);
  }, [rangeInput]);

  const canSubmit = Boolean(
    extractedSpreadsheetId &&
      isRangeValid &&
      aiProcessingApproved &&
      !isSaving &&
      !submitting
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !extractedSpreadsheetId || !onSave) return;

    setSubmitting(true);
    try {
      const cleanRange = rangeInput.trim();
      const cleanSheetName = sheetName.trim();

      // range 자체에 시트명이 이미 포함되어 있는지 확인
      let fullRange = cleanRange;
      if (cleanSheetName && !cleanRange.includes('!')) {
        fullRange = `${cleanSheetName}!${cleanRange}`;
      }

      const sourceId = `${extractedSpreadsheetId}!${fullRange}`;
      await onSave(sourceId, aiProcessingApproved);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-workspace-id={workspaceId}
      className="w-full max-w-[390px] mx-auto p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm text-zinc-900 dark:text-zinc-100 flex flex-col gap-4"
    >
      {/* 헤더 안내 */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Google Sheets 데이터 연동
          </span>
          <Badge variant="outline" className="text-xs px-2 py-0.5 font-normal">
            A1 명시 범위
          </Badge>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          소희가 읽을 메뉴판 또는 가격표 시트의 주소와 범위를 지정해 주세요.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* 스프레드시트 URL / ID 입력 */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={spreadsheetInputId}
            className="text-xs font-medium text-zinc-700 dark:text-zinc-300"
          >
            스프레드시트 주소 또는 ID
          </label>
          <input
            id={spreadsheetInputId}
            type="text"
            value={spreadsheetInput}
            onChange={(e) => setSpreadsheetInput(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
          />
          {spreadsheetInput.trim() && !extractedSpreadsheetId && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              올바른 Google Sheets 링크 또는 ID(10자 이상)를 입력해 주세요.
            </p>
          )}
        </div>

        {/* 시트 이름 입력 */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={sheetNameInputId}
            className="text-xs font-medium text-zinc-700 dark:text-zinc-300"
          >
            시트 이름
          </label>
          <input
            id={sheetNameInputId}
            type="text"
            value={sheetName}
            onChange={(e) => setSheetName(e.target.value)}
            placeholder="시트1"
            className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
          />
        </div>

        {/* A1 수집 범위 입력 및 프리셋 */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={rangeInputId}
            className="text-xs font-medium text-zinc-700 dark:text-zinc-300"
          >
            수집 범위 (A1 표기법)
          </label>
          <input
            id={rangeInputId}
            type="text"
            value={rangeInput}
            onChange={(e) => setRangeInput(e.target.value)}
            placeholder="A1:D50"
            className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
          />
          {rangeInput.trim() && !isRangeValid && (
            <p className="text-[11px] text-red-600 dark:text-red-400">
              올바른 A1 범위 형식(예: A1:D50)을 입력해 주세요.
            </p>
          )}

          {/* 프리셋 빠른 선택 */}
          <div className="flex items-center gap-1.5 pt-1">
            <span className="text-[11px] text-zinc-400">빠른 선택:</span>
            {PRESET_RANGES.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setRangeInput(preset)}
                className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                  rangeInput === preset
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* AI 마케팅 활용 동의 */}
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 mt-1">
          <input
            id={consentCheckboxId}
            type="checkbox"
            checked={aiProcessingApproved}
            onChange={(e) => setAiProcessingApproved(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
          />
          <label
            htmlFor={consentCheckboxId}
            className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed cursor-pointer"
          >
            소희 마케팅 지식 활용에 동의 (지정된 범위의 메뉴 및 가격 데이터만 안전하게 마케팅 후보 지식으로 반영됩니다)
          </label>
        </div>

        {/* 하단 버튼 액션 */}
        <div className="flex items-center gap-2 pt-2">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={isSaving || submitting}
              className="flex-1 text-xs h-9"
            >
              취소
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={!canSubmit}
            className="flex-1 text-xs h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
          >
            {isSaving || submitting ? '연동 중...' : '시트 범위 확정 및 연동'}
          </Button>
        </div>
      </form>
    </div>
  );
}

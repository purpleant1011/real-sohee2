'use client';

import React, { useState, useId, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Folder as FolderIcon, Clock, ShieldCheck } from 'lucide-react';

export interface OutlookFolder {
  readonly id: string;
  readonly displayName: string;
  readonly totalItemCount?: number;
  readonly unreadItemCount?: number;
}

export type OutlookSyncPeriod = '7d' | '14d' | '30d' | '90d' | 'all';

export interface OutlookFolderSelection {
  readonly folderId: string;
  readonly folderName: string;
  readonly period: OutlookSyncPeriod;
}

export interface OutlookFolderSelectorProps {
  readonly workspaceId: string;
  readonly initialFolders?: readonly OutlookFolder[];
  readonly initialSelectedFolderId?: string;
  readonly initialPeriod?: OutlookSyncPeriod;
  readonly onSave?: (
    selection: OutlookFolderSelection,
    aiProcessingApproved: boolean
  ) => void | Promise<void>;
  readonly onCancel?: () => void;
  readonly isSaving?: boolean;
}

const DEFAULT_FOLDERS: readonly OutlookFolder[] = [
  { id: 'inbox', displayName: '받은편지함' },
  { id: 'archive', displayName: '보관함' },
  { id: 'sentitems', displayName: '보낸편지함' },
];

const PERIOD_OPTIONS: readonly { value: OutlookSyncPeriod; label: string }[] = [
  { value: '7d', label: '최근 7일' },
  { value: '14d', label: '최근 14일' },
  { value: '30d', label: '최근 30일 (기본)' },
  { value: '90d', label: '최근 90일' },
  { value: 'all', label: '전체 기간' },
];

export function OutlookFolderSelector({
  workspaceId,
  initialFolders,
  initialSelectedFolderId,
  initialPeriod = '30d',
  onSave,
  onCancel,
  isSaving = false,
}: OutlookFolderSelectorProps): React.ReactElement {
  const folders = useMemo(() => {
    if (initialFolders && initialFolders.length > 0) {
      return initialFolders;
    }
    return DEFAULT_FOLDERS;
  }, [initialFolders]);

  const [selectedFolderId, setSelectedFolderId] = useState<string>(
    () => initialSelectedFolderId || folders[0]?.id || 'inbox'
  );
  const [selectedPeriod, setSelectedPeriod] = useState<OutlookSyncPeriod>(initialPeriod);
  const [aiProcessingApproved, setAiProcessingApproved] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const consentCheckboxId = useId();

  const selectedFolder = useMemo(() => {
    return folders.find((f) => f.id === selectedFolderId) || folders[0];
  }, [folders, selectedFolderId]);

  const canSubmit = Boolean(
    selectedFolderId &&
      aiProcessingApproved &&
      !isSaving &&
      !submitting
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !onSave || !selectedFolder) return;

    setSubmitting(true);
    try {
      await onSave(
        {
          folderId: selectedFolder.id,
          folderName: selectedFolder.displayName,
          period: selectedPeriod,
        },
        aiProcessingApproved
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-workspace-id={workspaceId}
      className="w-full max-w-[390px] mx-auto p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm text-zinc-900 dark:text-zinc-100 flex flex-col gap-4"
    >
      {/* 헤더 */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
            <FolderIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            Outlook 업무 폴더 연동
          </span>
          <Badge variant="outline" className="text-xs px-2 py-0.5 font-normal">
            Graph delta 증분 동기화
          </Badge>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          사장님이 지정한 업무 폴더와 기간의 이메일만 소희가 분석합니다. 개인 메일함은 읽지 않습니다.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* 폴더 선택 목록 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            연동할 메일 폴더 선택
          </label>
          <div className="flex flex-col gap-1.5 max-h-[160px] overflow-y-auto pr-1">
            {folders.map((folder) => {
              const isSelected = folder.id === selectedFolderId;
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => setSelectedFolderId(folder.id)}
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-left text-xs transition-colors ${
                    isSelected
                      ? 'border-blue-600 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 font-medium'
                      : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                  }`}
                  aria-pressed={isSelected}
                >
                  <div className="flex items-center gap-2 truncate">
                    <FolderIcon className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'}`} />
                    <span className="truncate">{folder.displayName}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {folder.unreadItemCount !== undefined && folder.unreadItemCount > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300">
                        {folder.unreadItemCount}
                      </span>
                    )}
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 동기화 기간 선택 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-zinc-500" />
            동기화 기간
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {PERIOD_OPTIONS.map((opt) => {
              const isSelected = opt.value === selectedPeriod;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSelectedPeriod(opt.value)}
                  className={`py-1.5 px-2 rounded-lg text-xs font-normal border transition-colors ${
                    isSelected
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium'
                      : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                  }`}
                  aria-pressed={isSelected}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* AI 분석 및 최소 권한 동의 체크박스 */}
        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-start gap-2.5">
          <input
            id={consentCheckboxId}
            type="checkbox"
            checked={aiProcessingApproved}
            onChange={(e) => setAiProcessingApproved(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
          />
          <div className="flex flex-col gap-0.5">
            <label
              htmlFor={consentCheckboxId}
              className="text-xs font-medium text-zinc-800 dark:text-zinc-200 cursor-pointer"
            >
              소희 업무 지원 활용에 동의
            </label>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
              발신자 이메일 주소는 마스킹되며, 본문은 5,000자 이내로 안전하게 축약됩니다.
            </p>
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="flex items-center gap-2 pt-1">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              className="flex-1 text-xs h-9 rounded-xl border-zinc-300 dark:border-zinc-700"
              disabled={isSaving || submitting}
            >
              취소
            </Button>
          )}
          <Button
            type="submit"
            disabled={!canSubmit}
            className="flex-1 text-xs h-9 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium"
          >
            {isSaving || submitting ? '연동 중...' : '선택한 폴더 연동 시작'}
          </Button>
        </div>
      </form>
    </div>
  );
}

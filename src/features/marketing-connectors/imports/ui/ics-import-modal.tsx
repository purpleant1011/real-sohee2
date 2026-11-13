'use client';

import React, { useState, useRef, useCallback, useMemo } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  parseCalendarPreview,
  CalendarImportError,
  type CalendarOccurrence,
  type CalendarParseWindow,
  type CalendarPreview,
} from '../ics-parser';
import { formatKoreanDateTime } from '@/lib/format-display-date';
import styles from './ics-import-modal.module.css';

const MAX_FILE_SIZE_BYTES = 500 * 1024; // 500KB

export interface IcsImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  window?: CalendarParseWindow;
  onConfirm?: (
    selectedOccurrences: CalendarOccurrence[],
    sourceHash: string
  ) => void | Promise<void>;
  isSubmitting?: boolean;
}

function getDefaultParseWindow(): CalendarParseWindow {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);

  const formatYmd = (d: Date) => d.toISOString().slice(0, 10);
  const startDate = formatYmd(start);
  const endDateExclusive = formatYmd(end);
  const startInstant = `${startDate}T00:00:00.000Z`;
  const endInstant = new Date(end.getTime() - 1).toISOString();

  return {
    startInstant,
    endInstant,
    startDate,
    endDateExclusive,
  };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = (bytes / 1024).toFixed(1);
  return `${kb} KB`;
}

function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function mapImportErrorToKorean(error: unknown): string {
  if (error instanceof CalendarImportError) {
    switch (error.code) {
      case 'TOO_LARGE':
        return '파일 크기가 너무 큽니다. 500KB 이하의 일정 파일(.ics)만 가져올 수 있습니다.';
      case 'LIMIT_EXCEEDED':
        return '캘린더 일정 개수 또는 처리 한도를 초과했습니다.';
      case 'UNSUPPORTED_RECURRENCE':
        return '지원되지 않는 반복 일정 규칙이 포함되어 있습니다. (일/주/월/년 반복만 지원)';
      case 'UNSUPPORTED_TIMEZONE':
        return '지원되지 않거나 명시되지 않은 시간대 정보가 포함되어 있습니다.';
      case 'INVALID_WINDOW':
        return '조회 기간 설정이 유효하지 않습니다.';
      case 'INVALID_ICS':
      default:
        return '올바른 iCalendar(.ics) 파일 형식이 아닙니다.';
    }
  }
  return '일정을 불러오는 중 오류가 발생했습니다. 다시 시도해 주세요.';
}

export function IcsImportModal({
  open,
  onOpenChange,
  window: propWindow,
  onConfirm,
  isSubmitting = false,
}: IcsImportModalProps): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [uploadedFile, setUploadedFile] = useState<{ name: string; size: number } | null>(null);
  const [preview, setPreview] = useState<CalendarPreview | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const effectiveWindow = useMemo(
    () => propWindow ?? getDefaultParseWindow(),
    [propWindow]
  );

  const resetState = useCallback(() => {
    setErrorMessage(null);
    setUploadedFile(null);
    setPreview(null);
    setSelectedIds(new Set());
    setIsParsing(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleProcessFile = useCallback(
    async (file: File) => {
      setErrorMessage(null);

      if (!file.name.toLowerCase().endsWith('.ics')) {
        setErrorMessage('.ics 확장자의 캘린더 파일만 업로드할 수 있습니다.');
        return;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        setErrorMessage('파일 크기가 너무 큽니다. 500KB 이하의 일정 파일(.ics)만 가져올 수 있습니다.');
        return;
      }

      setIsParsing(true);
      try {
        const icsText = await readFileAsText(file);
        const result = await parseCalendarPreview({
          icsText,
          window: effectiveWindow,
        });

        setUploadedFile({ name: file.name, size: file.size });
        setPreview(result);
        setSelectedIds(new Set(result.occurrences.map((occ) => occ.id)));
      } catch (err) {
        setErrorMessage(mapImportErrorToKorean(err));
        setUploadedFile(null);
        setPreview(null);
        setSelectedIds(new Set());
      } finally {
        setIsParsing(false);
      }
    },
    [effectiveWindow]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        void handleProcessFile(file);
      }
    },
    [handleProcessFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) {
        void handleProcessFile(file);
      }
    },
    [handleProcessFile]
  );

  const handleDropzoneClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleDropzoneKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInputRef.current?.click();
      }
    },
    []
  );

  const isAllSelected = useMemo(() => {
    if (!preview || preview.occurrences.length === 0) return false;
    return preview.occurrences.every((occ) => selectedIds.has(occ.id));
  }, [preview, selectedIds]);

  const handleToggleSelectAll = useCallback(() => {
    if (!preview) return;
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(preview.occurrences.map((occ) => occ.id)));
    }
  }, [preview, isAllSelected]);

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

  const handleConfirm = useCallback(() => {
    if (!preview || selectedIds.size === 0) return;
    const selectedOccurrences = preview.occurrences.filter((occ) =>
      selectedIds.has(occ.id)
    );
    void onConfirm?.(selectedOccurrences, preview.sourceHash);
  }, [preview, selectedIds, onConfirm]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const selectedCount = selectedIds.size;
  const totalCount = preview?.occurrences.length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetState();
        }
        onOpenChange(nextOpen);
      }}
      title="애플 캘린더 일정 파일(.ics) 가져오기"
    >
      <div className={styles.container}>
        {errorMessage && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>가져오기 오류</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        {!preview && (
          <div
            className={`${styles.dropzone} ${isDragging ? styles.dragActive : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleDropzoneClick}
            onKeyDown={handleDropzoneKeyDown}
            tabIndex={0}
            role="button"
            aria-label="애플 캘린더 일정 파일 드롭존"
            data-testid="ics-dropzone"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".ics,text/calendar"
              onChange={handleFileInputChange}
              onClick={(e) => e.stopPropagation()}
              className={styles.hiddenInput}
              aria-label="애플 캘린더 일정 파일 선택"
              data-testid="ics-file-input"
            />
            <svg
              className={styles.dropzoneIcon}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.75}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <p className={styles.dropzoneTitle}>
              {isParsing
                ? '파일을 분석하는 중입니다...'
                : '파일을 끌어다 놓거나 클릭하여 선택하세요'}
            </p>
            <p className={styles.dropzoneHint}>
              .ics 파일만 지원 (최대 500KB 크기 제한)
            </p>
          </div>
        )}

        {preview && uploadedFile && (
          <>
            <div className={styles.summaryHeader}>
              <div className={styles.fileMeta}>
                <span className={styles.fileName}>{uploadedFile.name}</span>
                <span className={styles.fileStats}>
                  {formatFileSize(uploadedFile.size)} · 총 {totalCount}개의 일정
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetState}
              >
                다른 파일 선택
              </Button>
            </div>

            {totalCount > 0 ? (
              <>
                <div className={styles.toolbar}>
                  <label className={styles.selectAllLabel}>
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={handleToggleSelectAll}
                      className={styles.itemCheckbox}
                      aria-label="전체 일정 선택"
                    />
                    <span>전체 선택</span>
                  </label>
                  <span className={styles.selectedBadge}>
                    {selectedCount}개 선택됨
                  </span>
                </div>

                <div className={styles.eventList} role="list" aria-label="일정 미리보기 목록">
                  {preview.occurrences.map((occ) => {
                    const isSelected = selectedIds.has(occ.id);
                    const title = occ.title || '제목 없는 일정';
                    return (
                      <div
                        key={occ.id}
                        className={`${styles.eventItem} ${isSelected ? styles.selected : ''}`}
                        onClick={() => handleToggleSelect(occ.id)}
                        role="listitem"
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => handleToggleSelect(occ.id)}
                          className={styles.itemCheckbox}
                          aria-label={`${title} 선택`}
                        />
                        <div className={styles.eventDetails}>
                          <div className={styles.eventHeader}>
                            <span className={styles.eventTitle}>{title}</span>
                            {occ.kind === 'all_day' && (
                              <Badge variant="secondary">종일</Badge>
                            )}
                            {occ.recurring && (
                              <Badge variant="purple">반복</Badge>
                            )}
                          </div>
                          <div className={styles.eventMeta}>
                            {occ.kind === 'all_day' ? (
                              <span>
                                {occ.startDate}
                                {occ.endDateExclusive &&
                                occ.endDateExclusive !== occ.startDate
                                  ? ` ~ ${occ.endDateExclusive}`
                                  : ''}
                              </span>
                            ) : (
                              <span>
                                {formatKoreanDateTime(occ.startsAt)} ~{' '}
                                {formatKoreanDateTime(occ.endsAt)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className={styles.emptyState}>
                가져올 수 있는 일정이 없습니다 (조회 기간 내 일정 없음).
              </div>
            )}
          </>
        )}

        <div className={styles.footer}>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isParsing || isSubmitting}
          >
            취소
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={handleConfirm}
            disabled={
              !preview ||
              selectedCount === 0 ||
              isParsing ||
              isSubmitting
            }
          >
            {isSubmitting
              ? '가져오는 중...'
              : selectedCount === 0
              ? '일정을 선택하세요'
              : `${selectedCount}개 일정 가져오기`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

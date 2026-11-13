'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Bookmark, Check, ExternalLink, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { z } from 'zod';
import { CanonicalDraftEditor } from './canonical-draft-editor';

export type StudioChannel = 'instagram' | 'threads' | 'naver_blog' | 'daangn_business';

export interface ContentDraftVariantData {
  channel: StudioChannel;
  title?: string;
  caption: string;
  hashtags: string[];
  status: 'READY' | 'NEEDS_FIX' | 'NEEDS_CHECK';
  statusLabel: string;
  issues: string[];
  contentId?: string;
  versionId?: string;
  vaultSavable: boolean;
}

export interface ContentDraftCardData {
  draftId: string;
  topic: string;
  variants: ContentDraftVariantData[];
  openInStudioPath?: string;
}

export interface ContentDraftCardProps {
  card: ContentDraftCardData;
  workspaceId: string;
  missionId?: string;
  runId?: string;
  onApprovalInvalidated?: () => void;
}

const CHANNEL_METAS: Record<StudioChannel, { label: string; icon: string }> = {
  instagram: { label: '인스타그램', icon: '📸' },
  threads: { label: '스레드', icon: '🧵' },
  naver_blog: { label: '네이버 블로그', icon: '📝' },
  daangn_business: { label: '당근', icon: '🥕' },
};

export function ContentDraftCard(props: ContentDraftCardProps) {
  return <ContentDraftCardBody key={`${props.workspaceId}:${props.missionId}:${props.runId}:${props.card.draftId}:${props.card.variants.map(variant => `${variant.contentId}:${variant.versionId}`).join(',')}`} {...props} />;
}

const reviewDisplaySchema = z.object({
  preview: z.object({
    workspaceId: z.string(), contentId: z.string(), versionId: z.string(),
    account: z.object({ label: z.string() }), text: z.string(), disclosure: z.string().optional(),
    media: z.array(z.object({
      id: z.string(), position: z.number().int().positive(), src: z.string().min(1), altText: z.string(),
      width: z.number().positive().nullable().optional(), height: z.number().positive().nullable().optional(),
    })),
  }),
  cost: z.object({ state: z.literal('UNKNOWN') }),
  approvalAllowed: z.literal(false), blockers: z.array(z.string()),
});

const missionQuoteDisplaySchema = z.object({
  workspaceId: z.string(), missionId: z.string(), runId: z.string(), contentId: z.string(), versionId: z.string(),
  quoteId: z.string().min(1), actionType: z.literal('SNS_DIRECT_PUBLISH'), requiredCredits: z.number().int().positive(),
  reviewFingerprint: z.string().regex(/^[a-f0-9]{64}$/), issuedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  executionAllowed: z.literal(false),
});

function MissionDraftReview({ workspaceId, missionId, runId, contentId, versionId }: {
  workspaceId: string; missionId: string; runId: string; contentId: string; versionId: string;
}) {
  const [review, setReview] = useState<z.infer<typeof reviewDisplaySchema> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState<z.infer<typeof missionQuoteDisplaySchema> | null>(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [disclosureConfirmed, setDisclosureConfirmed] = useState(false);
  const [approved, setApproved] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!quote) return;
    const timeout = setTimeout(() => {
      setQuote(null);
      setApproved(false);
      setRightsConfirmed(false);
      setDisclosureConfirmed(false);
      setError('견적이 만료되었습니다. 다시 확인해 주세요.');
    }, Math.max(0, Date.parse(quote.expiresAt) - Date.now()));
    return () => clearTimeout(timeout);
  }, [quote]);

  const matchesScope = (value: { workspaceId: string; missionId: string; runId: string; contentId: string; versionId: string }) =>
    value.workspaceId === workspaceId && value.missionId === missionId && value.runId === runId
    && value.contentId === contentId && value.versionId === versionId;

  const submitReview = async (action: 'ISSUE_QUOTE' | 'APPROVE_REVIEW') => {
    if (loading || (action === 'APPROVE_REVIEW' && (!quote || approved || !rightsConfirmed || !disclosureConfirmed || Date.parse(quote.expiresAt) <= Date.now()))) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    setApproved(false);
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/agent/artifact-review`, {
        method: 'POST', signal: controller.signal, cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, missionId, runId, contentId, versionId,
          ...(action === 'APPROVE_REVIEW' && quote ? { quoteId: quote.quoteId, reviewFingerprint: quote.reviewFingerprint, rightsConfirmed, disclosureConfirmed } : {}),
        }),
      });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || data.success !== true) throw new Error('REVIEW_UNCONFIRMED');
      if (action === 'ISSUE_QUOTE') {
        const parsed = missionQuoteDisplaySchema.safeParse(data.quote);
        const preview = reviewDisplaySchema.shape.preview.extend({ disclosure: z.string() }).safeParse(data.preview);
        if (!parsed.success || !preview.success || !matchesScope(parsed.data)
          || preview.data.workspaceId !== workspaceId || preview.data.contentId !== contentId || preview.data.versionId !== versionId
          || Date.parse(parsed.data.issuedAt) > Date.now() || Date.parse(parsed.data.expiresAt) <= Date.now()) throw new Error('QUOTE_UNAVAILABLE');
        setReview({ preview: preview.data, cost: { state: 'UNKNOWN' }, approvalAllowed: false, blockers: [] });
        setQuote(parsed.data);
        setRightsConfirmed(false);
        setDisclosureConfirmed(false);
      } else {
        const approval = data.reviewApproval;
        if (!quote || !approval || !matchesScope(approval) || typeof approval.approvalId !== 'string' || !approval.approvalId
          || approval.quoteId !== quote.quoteId || approval.reviewFingerprint !== quote.reviewFingerprint
          || approval.requiredCredits !== quote.requiredCredits || approval.state !== 'REVIEW_APPROVED'
          || approval.executionAllowed !== false || approval.rightsConfirmed !== true || approval.disclosureConfirmed !== true
          || typeof approval.decidedBy !== 'string' || !approval.decidedBy.trim()
          || !z.string().datetime().safeParse(approval.decidedAt).success
          || Date.parse(approval.decidedAt) < Date.parse(quote.issuedAt) || Date.parse(approval.decidedAt) > Date.now()
          || Date.parse(quote.expiresAt) <= Date.now()) throw new Error('APPROVAL_UNCONFIRMED');
        setApproved(true);
      }
    } catch {
      if (!controller.signal.aborted) {
        setQuote(null);
        setRightsConfirmed(false);
        setDisclosureConfirmed(false);
        setError('검토 결과를 확인하지 못했어요. 다시 확인해 주세요.');
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const loadReview = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setReview(null);
    setQuote(null);
    setApproved(false);
    setRightsConfirmed(false);
    setDisclosureConfirmed(false);
    setError(null);
    try {
      const query = new URLSearchParams({ missionId, runId, contentId, versionId });
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/agent/evidence?${query}`, { signal: controller.signal, cache: 'no-store' });
      const data = await response.json();
      if (controller.signal.aborted) return;
      const artifact = reviewDisplaySchema.safeParse(data.artifactReview);
      if (!response.ok || !artifact.success
        || data.workspaceId !== workspaceId || data.missionId !== missionId || data.runId !== runId
        || artifact.data.preview.workspaceId !== workspaceId || artifact.data.preview.contentId !== contentId || artifact.data.preview.versionId !== versionId) {
        throw new Error('REVIEW_UNAVAILABLE');
      }
      setReview(artifact.data);
    } catch {
      if (!controller.signal.aborted) setError('승인 조건을 확인하지 못했어요. 다시 확인해 주세요.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  return (
    <section aria-label="원고·사진·승인 조건" className="space-y-2 rounded-lg border border-border p-2.5">
      <button type="button" disabled={loading} onClick={loadReview} className="min-h-11 rounded-lg border border-border px-3 font-semibold disabled:opacity-50">
        {loading ? '승인 조건 확인 중…' : '원고·사진·승인 조건 확인'}
      </button>
      {error && <p role="alert">{error}</p>}
      {review && <>
        <p className="font-semibold">{review.preview.account.label}</p>
        <p className="whitespace-pre-wrap break-words">{review.preview.text}</p>
        {review.preview.disclosure && <p className="whitespace-pre-wrap break-words">{review.preview.disclosure}</p>}
        <ol className="space-y-2">
          {review.preview.media.map(media => <li key={media.id}>
            {/* eslint-disable-next-line @next/next/no-img-element -- workspace-authenticated media preview */}
            <img src={media.src} alt={media.altText} className="max-h-48 max-w-full rounded-lg object-contain" />
            <p>사진 {media.position}{media.width && media.height ? ` · ${media.width} × ${media.height}` : ' · 크기 확인 필요'}</p>
          </li>)}
        </ol>
        <ul className="space-y-1">{review.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul>
        <p>검토만 진행하며 게시하거나 발송하지 않습니다.</p>
        <button type="button" disabled={loading} onClick={() => submitReview('ISSUE_QUOTE')} className="min-h-11 rounded-lg border border-border px-3 font-semibold disabled:opacity-50">게시 견적 확인</button>
        {quote ? <>
          <p className="font-semibold">게시 견적: {quote.requiredCredits}크레딧</p>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={rightsConfirmed} disabled={loading || approved} onChange={event => setRightsConfirmed(event.target.checked)} />
            원고와 사진의 사용 권리를 확인했습니다
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={disclosureConfirmed} disabled={loading || approved} onChange={event => setDisclosureConfirmed(event.target.checked)} />
            게시 계정과 AI 보조 제작 표시를 확인했습니다
          </label>
          <button type="button" disabled={loading || approved || !rightsConfirmed || !disclosureConfirmed} onClick={() => submitReview('APPROVE_REVIEW')} className="min-h-11 rounded-lg border border-border px-3 font-semibold disabled:opacity-50">검토 내용에 동의하고 저장</button>
          {approved && <p role="status">검토 동의가 저장되었습니다. 게시하거나 발송하지 않았습니다.</p>}
        </> : <button type="button" disabled className="min-h-11 rounded-lg border border-border px-3 opacity-60">승인 조건 확인 필요</button>}
      </>}
    </section>
  );
}

function ContentDraftCardBody({ card, workspaceId, missionId, runId, onApprovalInvalidated }: ContentDraftCardProps) {
  const [overrides, setOverrides] = useState<Partial<Record<StudioChannel, ContentDraftVariantData>>>({});
  const [editingChannel, setEditingChannel] = useState<StudioChannel | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<StudioChannel>(
    card.variants[0]?.channel || 'instagram'
  );
  const [savedChannels, setSavedChannels] = useState<Set<StudioChannel>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const currentVariant = overrides[selectedChannel] || card.variants.find((v) => v.channel === selectedChannel) || card.variants[0];

  const handleSaveToVault = async () => {
    if (!currentVariant || !currentVariant.contentId || !currentVariant.versionId || isSaving || editingChannel) return;

    setIsSaving(true);
    setSaveError(null);

    const idempotencyKey = `vault-dock-${workspaceId}-${currentVariant.contentId}-${selectedChannel}-${Date.now()}`;

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/vault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentId: currentVariant.contentId,
          versionId: currentVariant.versionId,
          channels: [selectedChannel],
          targetDate: null,
          idempotencyKey,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.success !== false)) {
        setSavedChannels((prev) => new Set([...prev, selectedChannel]));
      } else {
        setSaveError(data.error || '보관함 저장에 실패했습니다.');
      }
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : '네트워크 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  const isSaved = savedChannels.has(selectedChannel);

  return (
    <div
      data-testid="content-draft-card"
      className="mt-2.5 rounded-xl border border-purple-200 dark:border-purple-900/60 bg-purple-50/40 dark:bg-purple-950/20 p-3 space-y-2.5 text-xs text-foreground shadow-2xs"
    >
      {/* Header: Topic & Link */}
      <div className="flex items-center justify-between border-b border-purple-200/60 dark:border-purple-900/40 pb-2">
        <div className="font-extrabold text-foreground truncate max-w-[70%]">
          {card.topic}
        </div>
        <Link
          href={card.openInStudioPath || `/app/content?studio=four-channel`}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:underline shrink-0"
        >
          <span>스튜디오에서 편집</span>
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {/* Channel Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none" role="tablist">
        {card.variants.map((v) => {
          const isSelected = v.channel === selectedChannel;
          const meta = CHANNEL_METAS[v.channel] || { label: v.channel, icon: '📄' };
          return (
            <button
              key={v.channel}
              role="tab"
              aria-selected={isSelected}
              disabled={!!editingChannel || isSaving}
              onClick={() => {
                setSelectedChannel(v.channel);
                setSaveError(null);
              }}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer shrink-0 ${
                isSelected
                  ? 'bg-purple-600 text-white shadow-2xs'
                  : 'bg-background/80 hover:bg-background text-muted-foreground hover:text-foreground border border-border/60'
              }`}
            >
              <span>{meta.icon}</span>
              <span>{meta.label}</span>
              {savedChannels.has(v.channel) && <Check className="w-2.5 h-2.5 text-emerald-300" />}
            </button>
          );
        })}
      </div>

      {/* Content Preview */}
      {currentVariant && (
        <div className="space-y-2 rounded-lg bg-background/90 p-2.5 border border-border/80">
          {/* Status Label & Issues */}
          <div className="flex items-center justify-between gap-2">
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                currentVariant.status === 'READY'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
              }`}
            >
              {currentVariant.statusLabel}
            </span>
            {currentVariant.issues.length > 0 && (
              <span className="text-[10px] text-muted-foreground truncate max-w-[60%]">
                {currentVariant.issues[0]}
              </span>
            )}
          </div>

          {/* Title (for Blog) */}
          {currentVariant.title && (
            <div className="font-bold text-foreground text-xs">
              {currentVariant.title}
            </div>
          )}

          {/* Caption / Text */}
          <div className="text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/90 max-h-48 overflow-y-auto">
            {currentVariant.caption}
          </div>

          {/* Hashtags */}
          {currentVariant.hashtags.length > 0 && (
            <div className="text-[10px] text-purple-600 dark:text-purple-400 font-medium">
              {currentVariant.hashtags.join(' ')}
            </div>
          )}
        </div>
      )}

      {currentVariant?.contentId && currentVariant.versionId && !isSaving && ['instagram', 'threads'].includes(currentVariant.channel) && (
        <CanonicalDraftEditor
          key={currentVariant.contentId}
          workspaceId={workspaceId}
          variant={currentVariant}
          onRevisionStarted={onApprovalInvalidated}
          onEditingChange={editing => setEditingChannel(editing ? selectedChannel : null)}
          onSaved={variant => {
            setOverrides(previous => ({ ...previous, [variant.channel]: variant }));
            setSavedChannels(previous => { const next = new Set(previous); next.delete(variant.channel); return next; });
          }}
        />
      )}

      {missionId && runId && currentVariant?.contentId && currentVariant.versionId && !editingChannel && !isSaving
        && ['instagram', 'threads'].includes(currentVariant.channel) && (
        <MissionDraftReview
          key={`${selectedChannel}:${currentVariant.contentId}:${currentVariant.versionId}`}
          workspaceId={workspaceId} missionId={missionId} runId={runId}
          contentId={currentVariant.contentId} versionId={currentVariant.versionId}
        />
      )}

      {/* Actions: Save to Vault */}
      <div className="flex items-center justify-between pt-0.5">
        <div className="text-[10px] text-muted-foreground">
          {saveError ? (
            <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-medium">
              <AlertCircle className="w-3 h-3" />
              <span>{saveError}</span>
            </span>
          ) : isSaved ? (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
              <Check className="w-3 h-3" />
              <span>보관함 저장 완료</span>
            </span>
          ) : (
            <span>보관함에 담아두면 언제든 수정 및 발행할 수 있어요.</span>
          )}
        </div>

        {currentVariant?.vaultSavable && !isSaved && (
          <button
            type="button"
            disabled={isSaving || !!editingChannel}
            onClick={handleSaveToVault}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-bold text-[11px] shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <Bookmark className="w-3 h-3" />
            <span>{isSaving ? '저장 중...' : '보관함에 담기'}</span>
          </button>
        )}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import type { ContentDraftVariantData } from './content-draft-card';

interface EditableContent {
  workspaceId: string;
  contentId: string;
  channel: string;
  currentVersionId: string;
  caption: string;
  hashtags: string[];
  fingerprint: string;
}

interface CanonicalDraftEditorProps {
  workspaceId: string;
  variant: ContentDraftVariantData;
  onEditingChange: (editing: boolean) => void;
  onSaved: (variant: ContentDraftVariantData) => void;
  onRevisionStarted?: () => void;
}

export function CanonicalDraftEditor({ workspaceId, variant, onEditingChange, onSaved, onRevisionStarted }: CanonicalDraftEditorProps) {
  const [source, setSource] = useState<EditableContent | null>(null);
  const [caption, setCaption] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function readContent(signal: AbortSignal): Promise<EditableContent> {
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/content`, { cache: 'no-store', signal });
    const data = await response.json();
    if (!response.ok || data.success !== true || !Array.isArray(data.contents)) throw new Error('CONTENT_UNAVAILABLE');
    const matches = data.contents.filter((item: EditableContent) => item.contentId === variant.contentId);
    const item = matches[0];
    if (matches.length !== 1 || item.workspaceId !== workspaceId || item.channel !== variant.channel ||
        typeof item.caption !== 'string' || !Array.isArray(item.hashtags) || !item.hashtags.every((tag: unknown) => typeof tag === 'string')) {
      throw new Error('CONTENT_SCOPE_CONFLICT');
    }
    return item;
  }

  async function openEditor() {
    if (busy) return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setEditing(true);
    onEditingChange(true);
    setSaved(false);
    setError(null);
    setBusy(true);
    try {
      const item = await readContent(controller.signal);
      if (controller.signal.aborted) return;
      if (item.currentVersionId !== variant.versionId) throw new Error('STALE_VERSION');
      setSource(item);
      setCaption(item.caption);
    } catch {
      if (!controller.signal.aborted) setError('최신 원고를 확인하지 못했어요. 다시 확인해 주세요.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function saveRevision() {
    if (busy || !source || !caption.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    const nextCaption = caption.trim();
    onRevisionStarted?.();
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/content/${encodeURIComponent(source.contentId)}/revisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ expectedVersionId: source.currentVersionId, caption: nextCaption }),
      });
      const data = await response.json();
      const revision = data.content;
      if (!response.ok || data.success !== true || revision?.contentId !== source.contentId ||
          typeof revision.versionId !== 'string' || !revision.versionId || revision.versionId === source.currentVersionId ||
          typeof revision.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(revision.fingerprint) || revision.status !== 'draft') {
        throw new Error('REVISION_NOT_CONFIRMED');
      }
      const readback = await readContent(controller.signal);
      if (controller.signal.aborted) return;
      if (readback.currentVersionId !== revision.versionId || readback.fingerprint !== revision.fingerprint ||
          readback.caption !== nextCaption || JSON.stringify(readback.hashtags) !== JSON.stringify(source.hashtags)) {
        throw new Error('REVISION_READBACK_CONFLICT');
      }
      onSaved({ ...variant, caption: readback.caption, hashtags: readback.hashtags, versionId: readback.currentVersionId });
      setEditing(false);
      onEditingChange(false);
      setSource(null);
      setSaved(true);
    } catch {
      if (!controller.signal.aborted) setError('수정 내용을 확인하지 못했어요. 최신 원고를 확인해 주세요.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {!editing && <button type="button" className="min-h-11 rounded-lg border border-border px-3 font-semibold cursor-pointer" onClick={openEditor}>원고 수정하기</button>}
      {editing && <section aria-label="일반 원고 수정" className="space-y-2">
        {busy && <p role="status">원고를 확인하고 있어요.</p>}
        {source && <>
          <textarea aria-label="원고 본문" className="min-h-32 w-full rounded-lg border border-border bg-background p-3 text-base md:text-sm" value={caption} disabled={busy} onChange={event => setCaption(event.target.value)} />
          <button type="button" className="min-h-11 rounded-lg bg-primary px-3 text-primary-foreground disabled:opacity-50 cursor-pointer" disabled={busy || !caption.trim() || caption.trim() === source.caption} onClick={saveRevision}>수정 내용 저장하기</button>
        </>}
        <button type="button" className="min-h-11 rounded-lg border border-border px-3 cursor-pointer" disabled={busy} onClick={() => { setEditing(false); setSource(null); setError(null); onEditingChange(false); }}>수정 취소하기</button>
      </section>}
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">원고를 저장했어요. 게시 전 다시 확인해 주세요.</p>}
    </div>
  );
}

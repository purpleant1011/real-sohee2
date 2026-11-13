'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { convertHeicPhoto, isHeicPhoto } from './heic-conversion'
import { DraftPhotoPicker } from './draft-photo-picker'
import type { DraftPhotoPeople } from './draft-photo-picker.types'

type SavedPhoto = { id: string; rights_status: string; publish_eligibility: boolean }
type UploadSession = { assetId: string; signedUrl: string; signature: string; transferred: boolean }

export function MediaUploadCard({ workspaceId, requirePhoto = false, purpose = 'first-post', onSelectionChange, fetcher = fetch }: {
  workspaceId: string; requirePhoto?: boolean; purpose?: 'first-post' | 'draft'; onSelectionChange?: (assetId: string | null) => void; fetcher?: typeof fetch
}) {
  const [file, setFile] = useState<File | null>(null)
  const [copyright, setCopyright] = useState(false)
  const [commercial, setCommercial] = useState(false)
  const [people, setPeople] = useState('unknown')
  const [consent, setConsent] = useState('')
  const [items, setItems] = useState<SavedPhoto[]>([])
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<string | null>(null)
  const [confirmWithdrawal, setConfirmWithdrawal] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const session = useRef<UploadSession | null>(null)
  const controller = useRef<AbortController | null>(null)
  const active = useRef(true)
  const selectionGeneration = useRef(0)
  const header = { 'x-workspace-id': workspaceId }

  const reload = useCallback(async () => {
    const generation = selectionGeneration.current
    if (!active.current) return
    const response = await fetcher('/api/onboarding/media', { headers: { 'x-workspace-id': workspaceId }, cache: 'no-store' })
    const data = await response.json()
    if (!active.current || generation !== selectionGeneration.current) return
    if (!response.ok) throw new Error(data.error || '저장한 사진을 불러오지 못했어요.')
    setItems(data.items ?? [])
  }, [workspaceId, fetcher])
  useEffect(() => {
    active.current = true
    session.current = null
    void reload().catch(e => { if (active.current) setError(e.message) })
    return () => { active.current = false; selectionGeneration.current++; controller.current?.abort() }
  }, [reload])

  function clearDraftSelection() {
    if (purpose !== 'draft') return
    setSelectedId(null)
    setNotice(null)
    onSelectionChange?.(null)
  }

  async function selectPhoto(assetId: string) {
    const generation = ++selectionGeneration.current
    clearDraftSelection()
    setError(null)
    setNotice(null)
    setPhase('사진 선택 중…')
    try {
      const response = await fetcher('/api/onboarding/media', {
        method: 'POST',
        headers: { ...header, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'select', assetId }),
      })
      const data = await response.json()
      if (!active.current || generation !== selectionGeneration.current) return
      if (!response.ok) throw new Error(data.error || '사진을 선택하지 못했어요.')
      if (data.selected !== true) throw new Error('사진 선택 저장을 확인하지 못했어요. 다시 선택해 주세요.')
      setSelectedId(assetId)
      onSelectionChange?.(assetId === 'none' ? null : assetId)
      setNotice(assetId === 'none' ? '원본 사진 없이 새 AI 이미지를 생성하도록 선택했어요.' : purpose === 'draft' ? '새 원고에 이 사진을 사용하도록 선택했어요.' : '첫 글에 이 사진을 사용하도록 선택했어요.')
    } catch (e) {
      if (active.current && generation === selectionGeneration.current) setError(e instanceof Error ? e.message : '사진을 선택하지 못했어요.')
    } finally {
      if (active.current && generation === selectionGeneration.current) setPhase(null)
    }
  }

  async function withdraw(assetId: string) {
    const generation = ++selectionGeneration.current
    if (selectedId === assetId) clearDraftSelection()
    setError(null)
    setPhase('사진 사용 중단 확인 중…')
    try {
      const response = await fetcher('/api/onboarding/media', { method: 'POST',
        headers: { ...header, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'withdraw', assetId }) })
      const data = await response.json()
      if (!active.current || generation !== selectionGeneration.current) return
      if (!response.ok) throw new Error(data.error || '사진 사용 중단을 확인하지 못했어요.')
      if (selectedId === assetId) {
        setSelectedId(null)
        setNotice(null)
        onSelectionChange?.(null)
      }
      await reload()
      setConfirmWithdrawal(null)
    } catch (e) { if (active.current && generation === selectionGeneration.current) setError(e instanceof Error ? e.message : '사진 사용 중단을 확인하지 못했어요.') }
    finally { if (active.current && generation === selectionGeneration.current) setPhase(null) }
  }

  async function pickFile(selected: File | null) {
    const generation = ++selectionGeneration.current
    controller.current?.abort()
    clearDraftSelection()
    setCopyright(false)
    setCommercial(false)
    setPeople('unknown')
    setConsent('')
    session.current = null
    setFile(null)
    setError(null)
    setNotice(null)
    if (!selected) return
    if (selected.size > 10 * 1024 * 1024 || (!isHeicPhoto(selected) && !['image/jpeg', 'image/png'].includes(selected.type))) {
      setError('10MB 이하의 JPG·PNG·HEIC 사진을 골라 주세요.')
      return
    }
    if (!isHeicPhoto(selected)) { setFile(selected); return }
    const abort = new AbortController()
    controller.current = abort
    setPhase('HEIC 사진을 이 기기에서 JPG로 변환 중…')
    try {
      const converted = await convertHeicPhoto(selected, { signal: abort.signal })
      if (!active.current || generation !== selectionGeneration.current || abort.signal.aborted) return
      setFile(converted)
      setNotice('HEIC 원본 대신 이 기기에서 변환한 JPG를 저장해요.')
    } catch {
      if (active.current && generation === selectionGeneration.current && !abort.signal.aborted) setError('HEIC 사진을 변환하지 못했어요. 24MP 이하 사진이나 JPG 또는 PNG로 다시 선택해 주세요.')
    } finally {
      if (active.current && generation === selectionGeneration.current) { setPhase(null); controller.current = null }
    }
  }

  async function upload() {
    if (!file) return
    setError(null)
    setIsUploading(true)
    const abort = new AbortController()
    controller.current = abort
    try {
      setPhase('사진 저장 준비 중…')
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
      const sha256Digest = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
      const rights = { copyright: copyright ? 'licensed' : 'unknown', commercialUse: commercial,
        identifiablePeople: people, consentReference: consent.trim() || null }
      const signature = JSON.stringify({ sha256Digest, rights })
      async function command(body: object) {
        const response = await fetcher('/api/onboarding/media', {
          method: 'POST', headers: { ...header, 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal: abort.signal,
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '사진을 저장하지 못했어요. 다시 시도해 주세요.')
        return data
      }
      if (session.current?.signature !== signature) {
        const data = await command({ action: 'begin', input: { mimeType: file.type, sizeBytes: file.size, sha256Digest, rights } })
        session.current = { assetId: data.assetId, signedUrl: data.signedUrl, signature, transferred: false }
      }
      const active = session.current!
      if (!active.transferred) {
        setPhase('사진 전송 중…')
        const response = await fetcher(active.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type, 'x-upsert': 'false' }, body: file, signal: abort.signal })
        // An interrupted successful transfer can return conflict on retry. Only server byte readback can accept it.
        let duplicate = response.status === 409
        if (!response.ok && response.status === 400) {
          const problem = await response.json().catch(() => null)
          duplicate = problem?.error === 'Duplicate' || String(problem?.statusCode) === '409'
        }
        if (!response.ok && !duplicate) throw new Error('사진 전송이 끊겼어요. 다시 시도해 주세요.')
        active.transferred = true
      }
      setPhase('사진 저장 확인 중…')
      await command({ action: 'complete', assetId: active.assetId })
      await reload()
      session.current = null
      setFile(null)
    } catch (e) {
      setError(e instanceof Error && e.name === 'AbortError'
        ? '전송 중단을 요청했어요. 이미 저장된 사진이 있는지 목록을 다시 확인해 주세요.'
        : e instanceof Error ? e.message : '사진을 저장하지 못했어요.')
    } finally {
      setIsUploading(false)
      setPhase(null)
      controller.current = null
    }
  }

  const currentPurpose: string = purpose
  if (currentPurpose === 'draft') {
    return (
      <DraftPhotoPicker
        workspaceId={workspaceId}
        items={items.map(i => ({
          id: i.id,
          eligible: i.rights_status === 'confirmed' && i.publish_eligibility,
          src: `/api/workspaces/${workspaceId}/media/${i.id}`,
        }))}
        selectedId={selectedId}
        phase={phase}
        isUploading={isUploading}
        error={error}
        notice={notice}
        file={file}
        copyright={copyright}
        people={people as DraftPhotoPeople}
        consent={consent}
        confirmWithdrawalId={confirmWithdrawal}
        onPickFile={f => void pickFile(f)}
        onCopyrightChange={c => {
          setCopyright(c)
          setCommercial(c)
        }}
        onPeopleChange={setPeople}
        onConsentChange={setConsent}
        onUpload={() => void upload()}
        onCancelTransfer={() => {
          if (phase?.startsWith('HEIC')) {
            selectionGeneration.current++
            controller.current?.abort()
            controller.current = null
            setPhase(null)
          } else controller.current?.abort()
        }}
        onReload={() => void reload().catch(e => setError(e.message))}
        onSelect={id => void selectPhoto(id)}
        onAskWithdraw={setConfirmWithdrawal}
        onWithdraw={id => void withdraw(id)}
      />
    )
  }

  return <section className="space-y-3 rounded-lg border p-4" aria-label="가게 사진">
    <h2 className="font-semibold">우리 가게 사진 <span className="text-sm font-normal text-muted-foreground">{requirePhoto ? '(필수)' : '(선택)'}</span></h2>
    <p className="text-sm text-muted-foreground">{requirePhoto ? purpose === 'draft' ? '새 원고에 사용할 사진을 저장하고 선택해 주세요. 실제 저장된 사진만 사용해요.' : '첫 글에 사용할 사진을 저장하고 선택해 주세요. 실제 저장된 사진만 사용해요.' : '사진이 없으면 기존에 가진 사진이나 글만으로 먼저 준비할 수 있어요. 실제로 저장된 사진만 아래에 표시해요.'}</p>
    <Label htmlFor="owner-photo">가게 사진 고르기</Label>
    <Input id="owner-photo" type="file" accept="image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif" disabled={Boolean(phase)} onChange={event => {
      const selected = event.target.files?.[0] ?? null
      event.target.value = ''
      void pickFile(selected)
    }} />
    <p className="text-xs text-muted-foreground">스마트폰 사진 모두 가능 (최대 10MB)</p>
    <fieldset className="space-y-3 text-sm" disabled={Boolean(phase)}>
      <legend className="mb-2 font-medium">사진 사용 권리 확인</legend>
      <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border border-border bg-card p-3 text-sm text-foreground select-none hover:bg-muted/30 transition-colors">
        <input
          type="checkbox"
          className="size-5 shrink-0 rounded border border-border accent-primary cursor-pointer"
          checked={copyright && commercial}
          onChange={e => { setCopyright(e.target.checked); setCommercial(e.target.checked) }}
        />
        <span>직접 촬영했거나 홍보에 사용할 수 있는 사진이에요.</span>
      </label>
      <Label htmlFor="photo-people">알아볼 수 있는 사람이 있나요?</Label>
      <select id="photo-people" value={people} onChange={e => setPeople(e.target.value)} className="min-h-11 w-full rounded-md border bg-background px-3">
        <option value="unknown">아직 확인하지 않았어요</option><option value="none">알아볼 수 있는 사람이 없어요</option><option value="consented">등장한 모든 사람의 홍보 사용 동의를 받았어요</option>
      </select>
      {people === 'consented' && <><Label htmlFor="photo-consent">보관 중인 동의 근거의 관리번호</Label><Input id="photo-consent" value={consent} onChange={e => setConsent(e.target.value)} maxLength={200} placeholder="이름·연락처가 아닌 관리번호를 적어 주세요" /></>}
    </fieldset>
    <p className="text-xs text-muted-foreground">권리가 확인되지 않은 사진은 비공개로 저장할 수 있지만 공개 게시에는 사용할 수 없어요.</p>
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    {phase && <p role="status">{phase}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" className="min-h-11" disabled={!file || Boolean(phase)} onClick={() => void upload()}>{error ? '사진 저장 다시 시도' : '사진 저장하기'}</Button>
      {phase === 'HEIC 사진을 이 기기에서 JPG로 변환 중…' && <Button type="button" variant="outline" className="min-h-11" onClick={() => {
        selectionGeneration.current++
        controller.current?.abort()
        controller.current = null
        setPhase(null)
      }}>변환 취소</Button>}
      {phase && isUploading && <Button type="button" variant="outline" className="min-h-11" onClick={() => controller.current?.abort()}>전송 중단</Button>}
      <Button type="button" variant="ghost" className="min-h-11" disabled={Boolean(phase)} onClick={() => void reload().catch(e => setError(e.message))}>저장한 사진 다시 확인</Button>
    </div>
    {!requirePhoto && <div className="space-y-1 pt-2">
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        disabled={Boolean(phase)}
        onClick={() => void selectPhoto('none')}
      >
        원본 사진 없이 새 시안 만들기
      </Button>
      <p className="text-xs text-muted-foreground">
        원본 사진을 사용하지 않고 새로운 AI 이미지를 생성해요.
      </p>
      <p className="text-xs text-muted-foreground">
        이미 만든 초안은 사진 선택만으로 바뀌지 않아요.
      </p>
    </div>}
    {items.length > 0 && <ul className="space-y-2" aria-label="저장한 사진">{items.map(item => <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-md border p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/workspaces/${workspaceId}/media/${item.id}`} alt="저장한 가게 원본 사진" width={64} height={64} className="size-16 rounded object-contain" />
      <p className="text-sm">사진 저장 확인 · 원본<br /><span className="text-xs text-muted-foreground">{item.rights_status === 'confirmed' && item.publish_eligibility ? '사용 권리 확인됨' : '공개 게시 전 권리 확인 필요'}</span></p>
      {item.rights_status === 'confirmed' && item.publish_eligibility ? (
        <Button
          type="button"
          className="min-h-11 w-full"
          disabled={Boolean(phase)}
          onClick={() => void selectPhoto(item.id)}
        >
          {purpose === 'draft' ? selectedId === item.id ? '원고용 사진 선택됨' : '이 사진 선택' : selectedId === item.id ? '첫 글에 이 사진 사용 선택됨' : '첫 글에 이 사진 사용'}
        </Button>
      ) : (
        <Button
          type="button"
          className="min-h-11 w-full"
          disabled={true}
        >
          첫 글에 이 사진 사용
        </Button>
      )}
      {item.rights_status !== 'rejected' && <Button type="button" variant="outline" className="min-h-11 w-full" disabled={Boolean(phase)} onClick={() => setConfirmWithdrawal(item.id)}>사진 공개 사용 중단</Button>}
      {confirmWithdrawal === item.id && <div className="w-full space-y-2 text-sm">
        <p>앞으로 이 사진을 공개 게시에 사용하지 않아요. 이미 게시된 사진은 자동으로 삭제되지 않아요.</p>
        <Button type="button" variant="destructive" className="min-h-11" disabled={Boolean(phase)} onClick={() => void withdraw(item.id)}>이 사진 사용 중단 확인</Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={() => setConfirmWithdrawal(null)}>취소</Button>
      </div>}
    </li>)}</ul>}
  </section>
}

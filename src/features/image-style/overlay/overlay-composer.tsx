'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { saveComposedImageAction } from '../actions/compose-image'
import { loadWorkspaceStyleSummaryAction } from '../actions/load-style-summary'
import { saveOverlayDefaultsAction } from '../actions/overlay-defaults'
import { drawOverlay, ensureOverlayFonts } from './overlay-renderer'
import {
  OVERLAY_PRESETS,
  computeOverlayLayout,
  type OverlayPresetId,
  type OverlayTexts,
} from './overlay-template'
import styles from './overlay-composer.module.css'

type Saved = Readonly<{ assetId: string; url: string }>

const EMPTY_TEXTS: OverlayTexts = { brandLine: '', designLine: '', quote: '', insetLabel: 'BEFORE' }
const TAINTED_ERROR_MESSAGE = '이 사진은 브라우저에서 합성할 수 없어요. 다른 사진으로 시도해 주세요.'

type Stored = Readonly<{ preset: OverlayPresetId; texts: OverlayTexts }>

function storageKey(workspaceId: string) {
  return `sohee:overlay:${workspaceId}`
}

function readStored(workspaceId: string): Stored | null {
  try {
    const raw = window.localStorage.getItem(storageKey(workspaceId))
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Stored>
      if (parsed && parsed.texts && OVERLAY_PRESETS.some((preset) => preset.id === parsed.preset)) {
        return { preset: parsed.preset as OverlayPresetId, texts: { ...EMPTY_TEXTS, ...parsed.texts } }
      }
    }
  } catch {
    // 저장된 값이 없거나 깨졌으면 기본값
  }
  return null
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('image_load_failed'))
    image.src = src
  })
}

async function getCanvasPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/png')
    } catch {
      resolve(null)
    }
  })
}

function getPresetHint(preset: OverlayPresetId): string {
  switch (preset) {
    case 'portrait-left':
    case 'portrait-right':
      return '전 사진이 없으면 삽입컷은 그리지 않아요.'
    case 'lash-circle':
      return '원형 삽입컷에는 핵심 디테일을 가까이 찍은 사진이 잘 어울려요.'
    case 'review-card':
      return '후기 문장은 고객 동의를 받은 내용만 넣어 주세요.'
  }
}

/**
 * 사진 위에 전(BEFORE) 삽입컷과 문구를 정확한 글자로 얹는다.
 * 글자는 사진 모델이 그리지 않고 브라우저 캔버스가 그린다 — 철자와 서식이 매번 똑같다.
 */
type OverlayComposerProps = Readonly<{ workspaceId: string; baseUrl: string | null; onSaved?: (saved: Saved) => void }>

export function OverlayComposer(props: OverlayComposerProps) {
  // 가게 전환 시 이전 가게의 문구·사진·편집 상태가 새 가게 저장소에 기록되지 않게 격리한다.
  return <WorkspaceOverlayComposer key={props.workspaceId} {...props} />
}

function WorkspaceOverlayComposer({
  workspaceId,
  baseUrl,
  onSaved,
}: OverlayComposerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [localStored] = useState<Stored | null>(() => (typeof window === 'undefined' ? null : readStored(workspaceId)))
  const [preset, setPreset] = useState<OverlayPresetId>(() => localStored?.preset ?? 'portrait-left')
  const [texts, setTexts] = useState<OverlayTexts>(() => localStored?.texts ?? EMPTY_TEXTS)
  const userEditedRef = useRef(false)
  const [defaultsLoaded, setDefaultsLoaded] = useState(false)
  const [beforeFile, setBeforeFile] = useState<File | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const [rendering, setRendering] = useState(false)

  useEffect(() => {
    if (localStored !== null) return
    let active = true
    void loadWorkspaceStyleSummaryAction({ workspaceId }).then((result) => {
      if (!active || userEditedRef.current) return
      if (result.data?.overlay) {
        const ov = result.data.overlay
        setPreset(ov.preset)
        setTexts({
          brandLine: ov.brandLine,
          designLine: ov.designLine,
          quote: ov.quote,
          insetLabel: ov.insetLabel,
        })
        setDefaultsLoaded(true)
      }
    }).catch(() => {
      if (active) setMessage({ kind: 'error', text: '기본 문구를 불러오지 못했어요. 입력한 내용은 그대로 두고 직접 편집할 수 있어요.' })
    })
    return () => {
      active = false
    }
  }, [workspaceId, localStored])

  useEffect(() => {
    if (localStored === null && !userEditedRef.current && !defaultsLoaded) return
    try {
      window.localStorage.setItem(storageKey(workspaceId), JSON.stringify({ preset, texts }))
    } catch {
      // 저장 공간을 못 써도 합성은 계속한다
    }
  }, [workspaceId, preset, texts, localStored, defaultsLoaded])

  const render = useCallback(async (): Promise<boolean> => {
    const canvas = canvasRef.current
    if (!canvas) return false
    const ctx = canvas.getContext('2d')
    if (!ctx) return false
    setRendering(true)
    try {
      await ensureOverlayFonts()
      const base = baseUrl ? await loadImage(baseUrl) : null
      let beforeUrl: string | null = null
      let before: HTMLImageElement | null = null
      if (beforeFile) {
        beforeUrl = URL.createObjectURL(beforeFile)
        before = await loadImage(beforeUrl)
      }
      const width = base?.naturalWidth || 1080
      const height = base?.naturalHeight || 1350
      canvas.width = width
      canvas.height = height
      const layout = computeOverlayLayout(
        { width, height },
        preset,
        texts,
        { beforeAspect: before ? Math.min(4, Math.max(0.5, before.naturalWidth / before.naturalHeight)) : null },
      )
      drawOverlay(ctx, layout, { base, before })
      if (beforeUrl) URL.revokeObjectURL(beforeUrl)
      return true
    } catch {
      setMessage({ kind: 'error', text: '사진을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' })
      return false
    } finally {
      setRendering(false)
    }
  }, [baseUrl, beforeFile, preset, texts])

  useEffect(() => {
    queueMicrotask(() => {
      void render()
    })
  }, [render])

  function save() {
    setMessage(null)
    startTransition(async () => {
      const drawn = await render()
      const canvas = canvasRef.current
      if (!drawn || !canvas) return
      const blob = await getCanvasPngBlob(canvas)
      if (!blob) {
        setMessage({ kind: 'error', text: TAINTED_ERROR_MESSAGE })
        return
      }
      const data = new FormData()
      data.set('workspaceId', workspaceId)
      data.set('file', new File([blob], 'composed.png', { type: 'image/png' }))
      const saved = await saveComposedImageAction(data).catch(() => null)
      if (!saved) {
        setMessage({ kind: 'error', text: '이미지를 저장하지 못했어요. 입력한 내용은 유지했으니 다시 시도해 주세요.' })
        return
      }
      if (saved.error) {
        setMessage({ kind: 'error', text: saved.error.message })
        return
      }
      setMessage({ kind: 'ok', text: '저장했어요.' })
      onSaved?.(saved.data)
    })
  }

  function download() {
    setMessage(null)
    startTransition(async () => {
      const drawn = await render()
      const canvas = canvasRef.current
      if (!drawn || !canvas) return
      const blob = await getCanvasPngBlob(canvas)
      if (!blob) {
        setMessage({ kind: 'error', text: TAINTED_ERROR_MESSAGE })
        return
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'sohee-composed.png'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    })
  }

  function setText<K extends keyof OverlayTexts>(key: K, value: string) {
    userEditedRef.current = true
    setTexts((current) => ({ ...current, [key]: value }))
  }

  function selectPreset(next: OverlayPresetId) {
    userEditedRef.current = true
    setPreset(next)
  }

  function saveDefaults() {
    setMessage(null)
    startTransition(async () => {
      const res = await saveOverlayDefaultsAction({ workspaceId, preset, texts }).catch(() => null)
      if (!res) {
        setMessage({ kind: 'error', text: '기본 문구를 저장하지 못했어요. 입력한 내용은 유지했으니 다시 시도해 주세요.' })
        return
      }
      if (res.error) {
        setMessage({ kind: 'error', text: res.error.message })
        return
      }
      setMessage({ kind: 'ok', text: '기본 문구로 저장했어요.' })
    })
  }

  const isReview = preset === 'review-card'

  return (
    <section aria-label="문구·삽입컷 얹기" className={styles.composer}>
      <div aria-label="합성 템플릿" className={styles.presets} role="group">
        {OVERLAY_PRESETS.map((item) => (
          <button aria-pressed={preset === item.id} className={preset === item.id ? styles.active : undefined} key={item.id} onClick={() => selectPreset(item.id)} title={item.description} type="button">
            {item.label}
          </button>
        ))}
      </div>
      <div className={styles.canvasBox}>
        <canvas aria-label="합성 미리보기" className={styles.canvas} ref={canvasRef} />
        {rendering ? <p className={styles.hint} role="status">그리는 중…</p> : null}
      </div>
      <label>
        {isReview ? '카드 제목' : '큰 제목 (흰색)'}
        <input maxLength={60} onChange={(e) => setText('brandLine', e.target.value)} placeholder={isReview ? '예: CUSTOMER REVIEW' : '예: 우리 가게 이름'} value={texts.brandLine} />
      </label>
      <label>
        {isReview ? '작은 소제목' : '포인트 문구 (보라색)'}
        <input maxLength={80} onChange={(e) => setText('designLine', e.target.value)} placeholder={isReview ? '예: 가게 이름' : '예: 대표 서비스 이름 또는 한 줄 소개'} value={texts.designLine} />
      </label>
      <label>
        {isReview ? '후기 내용' : '작은 본문 (줄바꿈 가능, 4줄까지)'}
        <textarea maxLength={320} onChange={(e) => setText('quote', e.target.value)} placeholder={'예: 한 줄 소개나 인사말\n줄바꿈으로 나눠 쓸 수 있어요.'} rows={3} value={texts.quote} />
      </label>
      {isReview ? null : (
        <>
          <label>
            전(BEFORE) 사진 (선택)
            <input accept="image/png,image/jpeg,image/webp" onChange={(e) => setBeforeFile(e.target.files?.[0] ?? null)} type="file" />
          </label>
          <label>
            삽입컷 라벨
            <input maxLength={20} onChange={(e) => setText('insetLabel', e.target.value)} value={texts.insetLabel} />
          </label>
        </>
      )}
      <button className={styles.download} disabled={pending || rendering} onClick={saveDefaults} type="button">
        이 문구를 기본값으로 저장
      </button>
      <p className={styles.hint}>{getPresetHint(preset)}</p>
      <div className={styles.actions}>
        <button className={styles.download} disabled={pending || rendering} onClick={download} type="button">
          내려받기
        </button>
        <button className={styles.save} disabled={pending || rendering} onClick={save} type="button">
          {pending ? '저장 중…' : '이 이미지 저장'}
        </button>
      </div>
      {message ? <p className={message.kind === 'ok' ? styles.ok : styles.error} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p> : null}
    </section>
  )
}

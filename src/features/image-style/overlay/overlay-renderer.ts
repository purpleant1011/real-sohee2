import type { OverlayLayout } from './overlay-template'

const SERIF = '"Cormorant Garamond", "Noto Serif KR", "Times New Roman", serif'
const SANS = '"Pretendard Variable", Pretendard, "Noto Sans KR", system-ui, sans-serif'

type Drawable = CanvasImageSource & { width: number; height: number }

export type OverlayImages = Readonly<{ base: Drawable | null; before: Drawable | null }>

/** 비율을 유지한 채 빈틈없이 채운다(cover). */
function coverRect(srcW: number, srcH: number, dstW: number, dstH: number) {
  const scale = Math.max(dstW / srcW, dstH / srcH)
  const w = Math.min(srcW, dstW / scale)
  const h = Math.min(srcH, dstH / scale)
  return { sx: (srcW - w) / 2, sy: (srcH - h) / 2, sw: w, sh: h }
}

function drawCover(ctx: CanvasRenderingContext2D, image: Drawable, x: number, y: number, w: number, h: number) {
  const { sx, sy, sw, sh } = coverRect(image.width, image.height, w, h)
  ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h)
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function drawOverlay(ctx: CanvasRenderingContext2D, layout: OverlayLayout, images: OverlayImages): void {
  if (layout.background) {
    ctx.fillStyle = layout.background
    ctx.fillRect(0, 0, layout.width, layout.height)
  }
  if (images.base) drawCover(ctx, images.base, 0, 0, layout.width, layout.height)

  if (layout.header) {
    ctx.fillStyle = layout.header.fill
    ctx.fillRect(layout.header.x, layout.header.y, layout.header.w, layout.header.h)
  }
  if (layout.panel) {
    ctx.fillStyle = layout.panel.fill
    roundedRect(ctx, layout.panel.x, layout.panel.y, layout.panel.w, layout.panel.h, layout.panel.radius)
    ctx.fill()
  }

  if (layout.inset && images.before) {
    const { x, y, w, h, shape } = layout.inset
    ctx.save()
    ctx.beginPath()
    if (shape === 'circle') ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2)
    else ctx.rect(x, y, w, h)
    ctx.clip()
    drawCover(ctx, images.before, x, y, w, h)
    ctx.restore()

    ctx.save()
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.font = `400 ${layout.inset.labelSize}px ${SERIF}`
    ctx.shadowColor = 'rgba(0,0,0,0.25)'
    ctx.shadowBlur = layout.inset.labelSize * 0.15
    ctx.fillText(layout.inset.label, layout.inset.labelX, layout.inset.labelY)
    ctx.restore()
  }

  for (const text of layout.texts) {
    ctx.save()
    ctx.fillStyle = text.color
    ctx.textAlign = text.align
    ctx.font = `${text.weight} ${text.size}px ${text.font === 'serif' ? SERIF : SANS}`
    if (!layout.panel) {
      ctx.shadowColor = 'rgba(0,0,0,0.32)'
      ctx.shadowBlur = text.size * 0.16
    }
    ctx.fillText(text.text, text.x, text.y)
    ctx.restore()
  }
}

/** CSS의 @font-face가 등록된 뒤 글꼴을 요청한다. 네트워크가 막혀도 총 3초 안에 대체 글꼴로 진행한다. */
export async function ensureOverlayFonts(): Promise<void> {
  if (typeof document === 'undefined') return
  const deadline = Date.now() + 3000
  const id = 'sohee-overlay-fonts'
  let link = document.getElementById(id) as HTMLLinkElement | null
  const isNew = !link
  if (!link) {
    link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500&family=Noto+Serif+KR:wght@400;500&display=swap'
  }
  const stylesheet = link
  const ready = await new Promise<boolean>((resolve) => {
    if (stylesheet.sheet || stylesheet.dataset.loaded === 'true') { resolve(true); return }
    if (stylesheet.dataset.failed === 'true') { resolve(false); return }
    const finish = (success: boolean) => {
      clearTimeout(timer)
      stylesheet.removeEventListener('load', loaded)
      stylesheet.removeEventListener('error', failed)
      if (success) stylesheet.dataset.loaded = 'true'
      resolve(success)
    }
    const loaded = () => finish(true)
    const failed = () => { stylesheet.dataset.failed = 'true'; finish(false) }
    const timer = setTimeout(() => finish(false), Math.max(0, deadline - Date.now()))
    stylesheet.addEventListener('load', loaded, { once: true })
    stylesheet.addEventListener('error', failed, { once: true })
    if (isNew) document.head.appendChild(stylesheet)
  })
  if (!ready || !document.fonts) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('500 40px "Cormorant Garamond"'),
        document.fonts.load('400 40px "Noto Serif KR"'),
      ]),
      new Promise((resolve) => { timer = setTimeout(resolve, Math.max(0, deadline - Date.now())) }),
    ])
  } catch {
    // 로컬 한글 글꼴과 시스템 대체 글꼴로 진행한다.
  } finally {
    clearTimeout(timer)
  }
}

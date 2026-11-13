import { describe, expect, it } from 'vitest'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { MARKETING_ASSETS } from './v085-assets'

/**
 * [ANI-1741] 자산 매니페스트가 실제 파일을 가리키는지 확인한다.
 *
 * 표시용 자산을 PNG → WebP 로 바꾸면서 src 경로가 실제 파일과 어긋나면
 * 이미지가 조용히 깨진다(빌드도 테스트도 통과한다). 그 회귀를 여기서 막는다.
 */
const PUBLIC_DIR = resolve(process.cwd(), 'public')

const entries = Object.entries(MARKETING_ASSETS)

describe('MARKETING_ASSETS 파일 실재', () => {
  it('18개 자산이 모두 정의되어 있다', () => {
    expect(entries).toHaveLength(18)
  })

  it.each(entries)('%s 의 src 가 public/ 아래 실제 파일이다', (_key, asset) => {
    expect(asset.src.startsWith('/images/marketing/v085/')).toBe(true)
    const absolute = resolve(PUBLIC_DIR, `.${asset.src}`)
    expect(existsSync(absolute), `없는 파일: ${asset.src}`).toBe(true)
    expect(statSync(absolute).size).toBeGreaterThan(0)
  })

  it.each(entries)('%s 는 width/height 와 alt 를 갖는다', (_key, asset) => {
    expect(asset.width).toBeGreaterThan(0)
    expect(asset.height).toBeGreaterThan(0)
    expect(asset.alt.trim().length).toBeGreaterThan(0)
  })

  it('표시용 자산은 WebP 를 쓴다 (모바일 전송량)', () => {
    const display = entries.filter(([key]) => key !== 'openGraph')
    for (const [key, asset] of display) {
      expect(asset.src.endsWith('.webp'), `${key} 가 WebP 가 아니다: ${asset.src}`).toBe(true)
    }
  })

  it('OG(소셜 미리보기)는 크롤러 호환을 위해 PNG 를 유지한다', () => {
    expect(MARKETING_ASSETS.openGraph.src.endsWith('.png')).toBe(true)
  })

  it('WebP 변형은 같은 그림의 PNG 원본보다 작다', () => {
    for (const [key, asset] of entries) {
      if (!asset.src.endsWith('.webp')) continue
      const webp = resolve(PUBLIC_DIR, `.${asset.src}`)
      const png = webp.replace(/\.webp$/u, '.png')
      // PNG 원본을 지웠다면 이 비교는 의미가 없으므로 건너뛴다(원본 보존은 별도 규칙).
      if (!existsSync(png)) continue
      expect(statSync(webp).size, `${key}: WebP 가 PNG 보다 크다`).toBeLessThan(statSync(png).size)
    }
  })
})

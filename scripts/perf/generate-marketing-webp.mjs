#!/usr/bin/env node
/**
 * 홍보 사이트 이미지의 WebP 변형 생성기 (Linear ANI-1741).
 *
 * 왜 필요한가:
 *   next.config.ts 의 `images.unoptimized: true` 때문에 `next/image` 가 srcset/포맷 변환을 하지 않는다.
 *   그 결과 390px 폰에도 1536x1024 PNG(1.7~2.5MB)가 그대로 내려간다(기준선 실측: 랜딩 이미지 4.16MB).
 *   PNG 원본은 남겨 두고, 표시용 WebP 변형만 생성해 자산 매니페스트가 그쪽을 가리키게 한다.
 *
 * 원본 PNG 는 삭제하지 않는다. 소셜 크롤러(OG 이미지)는 PNG 를 그대로 쓴다.
 *
 * 사용:
 *   node scripts/perf/generate-marketing-webp.mjs            # 없는 변형만 생성
 *   node scripts/perf/generate-marketing-webp.mjs --force    # 전부 다시 생성
 *
 * cwebp 가 없으면 조용히 넘어가지 않고 실패한다(변환했다고 거짓 보고하지 않기 위해).
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** 품질 82: 평면 일러스트 위주 자산에서 육안 차이가 거의 없으면서 PNG 대비 95% 이상 감소한다. */
export const WEBP_QUALITY = 82

/** OG(소셜 미리보기) 이미지는 크롤러 호환을 위해 PNG 로 유지한다. */
const KEEP_PNG = new Set(['sohee-marketing-og-v1.png'])

const ASSET_DIR = resolve('public/images/marketing/v085')

export function listConvertibleAssets(dir = ASSET_DIR) {
  if (!existsSync(dir)) throw new Error(`자산 디렉터리가 없습니다: ${dir}`)
  return readdirSync(dir)
    .filter((name) => name.endsWith('.png') && !KEEP_PNG.has(name))
    .sort()
}

export function webpNameFor(pngName) {
  return pngName.replace(/\.png$/u, '.webp')
}

function hasCwebp() {
  try {
    execFileSync('cwebp', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function convert(dir, name, { force = false } = {}) {
  const source = join(dir, name)
  const target = join(dir, webpNameFor(name))
  if (!force && existsSync(target)) {
    return { name, target, skipped: true, bytes: statSync(target).size }
  }
  execFileSync('cwebp', ['-quiet', '-q', String(WEBP_QUALITY), source, '-o', target], { stdio: 'pipe' })
  return {
    name,
    target,
    skipped: false,
    sourceBytes: statSync(source).size,
    bytes: statSync(target).size,
  }
}

function main() {
  const force = process.argv.includes('--force')
  if (!hasCwebp()) {
    console.error('cwebp 를 찾을 수 없습니다. `brew install webp` 후 다시 실행하세요. (변환하지 않았습니다)')
    process.exitCode = 1
    return
  }
  const names = listConvertibleAssets()
  let totalSource = 0
  let totalTarget = 0
  for (const name of names) {
    const result = convert(ASSET_DIR, name, { force })
    if (!result.skipped) {
      totalSource += result.sourceBytes
      totalTarget += result.bytes
    }
    const ratio = result.skipped ? '기존' : `${Math.round((1 - result.bytes / result.sourceBytes) * 100)}% 감소`
    console.log(`${result.skipped ? '·' : '✓'} ${name} → ${webpNameFor(name)} (${Math.round(result.bytes / 1024)}kB, ${ratio})`)
  }
  if (totalSource > 0) {
    console.log(`\n합계: ${Math.round(totalSource / 1024)}kB → ${Math.round(totalTarget / 1024)}kB`)
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main()

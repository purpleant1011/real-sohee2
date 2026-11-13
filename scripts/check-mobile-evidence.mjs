#!/usr/bin/env node
// 모바일 증거 존재 검사: evidence/v092/**/ 에 390px 스크린샷(png)과 측정 수치 파일(json)이 있어야 통과.
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const root = path.join(process.cwd(), 'evidence', 'v092')
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}
let files = []
try { files = walk(root) } catch { console.error('evidence/v092 를 읽지 못했어요.'); process.exit(2) }
const shots = files.filter((f) => /390.*\.png$/.test(f) && statSync(f).size > 0)
const metrics = files.filter((f) => /(metrics|measure|measurement).*\.json$/i.test(path.basename(f)) && statSync(f).size > 0)
console.log(`390px 스크린샷 ${shots.length}장, 측정 수치 파일 ${metrics.length}개`)
if (shots.length === 0) { console.error('390px 스크린샷이 없어요.'); process.exit(1) }
if (metrics.length === 0) { console.error('측정 수치 파일(metrics*.json)이 없어요. 스크린샷만으로는 측정 증거가 아니에요.'); process.exit(1) }

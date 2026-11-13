import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 원색 유틸 가드 (ANI-1666 후속, DESIGN-SYSTEM §3.4).
 * Tailwind 원색 팔레트(bg-purple-600, text-emerald-700 …)는 시맨틱 토큰으로 치환한다.
 * `raw-palette-legacy.txt` 에 없는 파일은 원색 유틸을 한 건도 쓸 수 없다.
 * 레거시 목록은 줄이기만 한다 — 화면군을 정리한 PR 은 해당 줄을 지운다.
 */
const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const PALETTE =
  /(?<![\w-])(?:[a-z0-9[\]_-]+:)*(?:bg|text|border(?:-[lrtbxyse])?|ring|from|to|via|fill|stroke|divide|outline|decoration|accent|shadow|placeholder)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?:\/\d+)?(?![\w-])/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const legacy = new Set(
  readFileSync(join(__dirname, "raw-palette-legacy.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean),
);
const files = walk(SRC).map((f) => ({ f, rel: relative(ROOT, f) }));
const offenders = files.filter(({ f }) => PALETTE.test(readFileSync(f, "utf8"))).map(({ rel }) => rel);

describe("원색 유틸 가드", () => {
  it("레거시 목록 밖의 파일은 원색 유틸을 쓰지 않는다", () => {
    expect(offenders.filter((r) => !legacy.has(r))).toEqual([]);
  });

  it("정리가 끝난 파일은 레거시 목록에서 지운다", () => {
    const set = new Set(offenders);
    expect([...legacy].filter((r) => !set.has(r))).toEqual([]);
  });
});

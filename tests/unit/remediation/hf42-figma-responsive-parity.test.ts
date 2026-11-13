import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('HF-42: Figma Responsive Visual Parity (ANI-1391)', () => {
  const rootDir = process.cwd();
  const parityDir = path.join(rootDir, 'docs/evidence/v091-first-revision/visual-parity');
  const reportPath = path.join(parityDir, 'figma-parity-report.json');
  const currentDir = path.join(parityDir, 'current');
  const refDir = path.join(parityDir, 'reference');
  const diffDir = path.join(parityDir, 'diff');

  const expectedSurfaces = ['151:3', '151:4', '151:5', '151:6', '151:7', '151:8'];
  const expectedViewports = ['desktop-1440', 'laptop-1024', 'tablet-768', 'mobile-375'];

  it('G-PARITY-1: figma-parity-report.json exists and asserts PASS_FIGMA_PARITY_QUALIFIED', () => {
    expect(fs.existsSync(reportPath)).toBe(true);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

    expect(report.overallVerdict).toBe('PASS_FIGMA_PARITY_QUALIFIED');
    expect(report.totalCaptures).toBe(24);
    expect(report.passedCaptures).toBe(24);
    expect(report.failedCaptures).toBe(0);
    expect(report.horizontalOverflowFailures).toBe(0);
    expect(report.blockerVisualMismatches).toBe(0);
  });

  it('G-PARITY-2: 6 canonical Figma surfaces are evaluated across all 4 viewports', () => {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const nodes = report.canonicalNodes.map((n: any) => n.nodeId);
    for (const expectedNode of expectedSurfaces) {
      expect(nodes).toContain(expectedNode);
    }

    const captures = report.captures;
    expect(captures.length).toBe(24);

    for (const surfaceId of expectedSurfaces) {
      for (const vp of expectedViewports) {
        const match = captures.find((c: any) => c.nodeId === surfaceId && c.viewport === vp);
        expect(match, `Missing capture for ${surfaceId} at ${vp}`).toBeDefined();
        expect(match.verdict).toBe('PASS');
        expect(match.hasHorizontalOverflow).toBe(false);
        expect(match.overflowPixels).toBe(0);
        expect(match.visibleButtonCount).toBeGreaterThan(0);
      }
    }
  });

  it('G-PARITY-3: all 24 current screenshots exist on disk and have valid payload size', () => {
    const files = fs.readdirSync(currentDir).filter(f => f.endsWith('.png'));
    expect(files.length).toBe(24);

    for (const file of files) {
      const filePath = path.join(currentDir, file);
      const stat = fs.statSync(filePath);
      expect(stat.size, `Screenshot ${file} is too small or empty`).toBeGreaterThan(5000);
    }
  });

  it('G-PARITY-4: reference specifications exist for all 6 canonical surfaces', () => {
    const refFiles = fs.readdirSync(refDir).filter(f => f.endsWith('.json'));
    expect(refFiles.length).toBe(6);

    for (const file of refFiles) {
      const content = JSON.parse(fs.readFileSync(path.join(refDir, file), 'utf8'));
      expect(expectedSurfaces).toContain(content.figmaNodeId);
      expect(content.acceptanceCriteria.zeroHorizontalOverflow).toBe(true);
      expect(content.acceptanceCriteria.blockerVisualMismatch).toBe(0);
    }
  });

  it('G-PARITY-5: diff matrix and markdown report exist with zero blocker mismatch', () => {
    const diffMatrixPath = path.join(diffDir, 'visual-parity-diff-matrix.json');
    expect(fs.existsSync(diffMatrixPath)).toBe(true);
    const matrix = JSON.parse(fs.readFileSync(diffMatrixPath, 'utf8'));
    expect(matrix.length).toBe(24);

    const mdPath = path.join(parityDir, 'figma-parity-report.md');
    expect(fs.existsSync(mdPath)).toBe(true);
    const md = fs.readFileSync(mdPath, 'utf8');
    expect(md).toContain('PASS_FIGMA_PARITY_QUALIFIED');
    expect(md).toContain('Zero Overflow Guarantee');
  });
});

/**
 * Sohee V0.9 5th Update · Wave 5 Traceability Unit Tests
 * Linear Wave · Dependency · Code Path Execution Map Verification
 * 
 * Traceability: ANI-936
 */

import { describe, it, expect } from 'vitest';
import {
  CANONICAL_EXECUTION_MAP,
  getLinearNode,
  listNodesByWave,
} from '@/features/traceability/linear-execution-map';

describe('V0.9 Wave 5 · LinearExecutionMap (ANI-936)', () => {
  it('contains all 29 canonical issues mapped across Wave 0 to Wave 5', () => {
    // 24 Core + 4 New P0s (ANI-938, ANI-939, ANI-940, ANI-941) + 1 CI Governance (ANI-942) = 29 issues
    expect(CANONICAL_EXECUTION_MAP.length).toBe(29);

    const wave0 = listNodesByWave('Wave 0');
    const wave1 = listNodesByWave('Wave 1');
    const wave2 = listNodesByWave('Wave 2');
    const wave3 = listNodesByWave('Wave 3');
    const wave4 = listNodesByWave('Wave 4');
    const wave5 = listNodesByWave('Wave 5');

    expect(wave0.length).toBe(5); // ANI-914, 915, 916, 917, 941
    expect(wave1.length).toBe(5); // ANI-918, 919, 920, 921, 939
    expect(wave2.length).toBe(6); // ANI-922, 923, 924, 925, 938, 940
    expect(wave3.length).toBe(6); // ANI-935, 927, 928, 929, 930, 931
    expect(wave4.length).toBe(2); // ANI-932, 933
    expect(wave5.length).toBe(5); // ANI-942, 937, 936, 934, 926
  });

  it('validates that every node has code paths, tests, and valid GitHub issue numbers', () => {
    for (const node of CANONICAL_EXECUTION_MAP) {
      expect(node.linearId).toMatch(/^ANI-\d+$/);
      expect(node.githubIssueNumber).toBeGreaterThan(700);
      expect(node.title).toBeTruthy();
      expect(node.primaryCodePaths.length).toBeGreaterThan(0);
      expect(node.testPaths.length).toBeGreaterThan(0);
      expect(node.verificationGate).toBeTruthy();
    }
  });

  it('ensures dependency blockers form an acyclic graph without self-dependencies', () => {
    const allIds = new Set(CANONICAL_EXECUTION_MAP.map(n => n.linearId));

    for (const node of CANONICAL_EXECUTION_MAP) {
      for (const blocker of node.blockers) {
        expect(allIds.has(blocker)).toBe(true);
        expect(blocker).not.toBe(node.linearId); // No self-dependency
      }
    }
  });

  it('correctly retrieves specific nodes via getLinearNode', () => {
    const ani914 = getLinearNode('ANI-914');
    expect(ani914).toBeDefined();
    expect(ani914?.wave).toBe('Wave 0');
    expect(ani914?.githubIssueNumber).toBe(732);

    const ani936 = getLinearNode('ANI-936');
    expect(ani936).toBeDefined();
    expect(ani936?.wave).toBe('Wave 5');
    expect(ani936?.githubIssueNumber).toBe(754);
  });
});

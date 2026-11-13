import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

interface V10ReclassificationItem {
  v10_issue_id: string;
  title: string;
  v10_reported_status: 'Done';
  qa10_verdict: 'VERIFIED_DONE' | 'PARTIAL_UNWIRED' | 'FAILED';
  v11_state: 'REQUIRED' | 'IMPLEMENTED' | 'PRODUCTION_VERIFIED';
  qa10_defect_ref?: string;
  current_callsite_gap?: string;
  v11_successor_issue: string;
}

interface V10AuditDataset {
  schema_version: 'qa11.audit.v1';
  audit_run_id: string;
  git_sha: string;
  total_issues: 43;
  summary: {
    verified_done: number;
    partial_unwired: number;
    failed: number;
  };
  items: V10ReclassificationItem[];
}

describe('ANI-1109: 10th Revision 43 Done False-Green Reclassification Gate', () => {
  const auditFilePath = path.join(process.cwd(), 'qa/11th/audit/v10-43-issues-reclassification.json');

  it('must have machine-readable audit dataset for all 43 issues of 10th revision', () => {
    expect(fs.existsSync(auditFilePath)).toBe(true);

    const raw = fs.readFileSync(auditFilePath, 'utf8');
    const data: V10AuditDataset = JSON.parse(raw);

    expect(data.schema_version).toBe('qa11.audit.v1');
    expect(data.total_issues).toBe(43);
    expect(data.items.length).toBe(43);

    // Summary counts match QA10 reverification findings
    expect(data.summary.verified_done).toBe(9);
    expect(data.summary.partial_unwired).toBe(18);
    expect(data.summary.failed).toBe(16);

    const verifiedCount = data.items.filter(i => i.qa10_verdict === 'VERIFIED_DONE').length;
    const partialCount = data.items.filter(i => i.qa10_verdict === 'PARTIAL_UNWIRED').length;
    const failedCount = data.items.filter(i => i.qa10_verdict === 'FAILED').length;

    expect(verifiedCount).toBe(9);
    expect(partialCount).toBe(18);
    expect(failedCount).toBe(16);

    // All 43 items must have valid v11 successors and gap descriptions for non-verified items
    for (const item of data.items) {
      expect(item.v10_issue_id).toMatch(/^ANI-10(3[3-9]|[4-6][0-9]|7[0-5])$/);
      expect(item.v11_successor_issue).toMatch(/^ANI-11(0[9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|50)$/);

      if (item.qa10_verdict !== 'VERIFIED_DONE') {
        expect(item.v11_state).toBe('REQUIRED');
        expect(item.qa10_defect_ref).toBeDefined();
        expect(item.qa10_defect_ref!.length).toBeGreaterThan(0);
        expect(item.current_callsite_gap).toBeDefined();
        expect(item.current_callsite_gap!.length).toBeGreaterThan(0);
      } else {
        expect(item.v11_state).toBe('PRODUCTION_VERIFIED');
      }
    }
  });
});

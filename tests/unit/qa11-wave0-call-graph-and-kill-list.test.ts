import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

interface CallGraphEntrypoint {
  name: string;
  category: 'chat' | 'content' | 'approval' | 'publishing' | 'readback' | 'admin';
  live_route_file: string;
  current_active_path: string;
  legacy_callsites: string[];
  canonical_target_path: string;
  canonical_status: 'UNWIRED' | 'PARTIAL' | 'CANONICAL_WIRED';
}

interface KillListItem {
  id: string;
  legacy_symbol: string;
  file_path: string;
  forbidden_in: string[];
  canonical_replacement: string;
  target_wave: number;
}

interface RuntimeCallGraphManifest {
  schema_version: 'qa11.callgraph.v1';
  generated_at: string;
  git_sha: string;
  entrypoints: CallGraphEntrypoint[];
  kill_list: KillListItem[];
  unwired_canonical_modules: Array<{
    module_name: string;
    file_path: string;
    intended_callsite: string;
    target_wave: number;
  }>;
}

describe('ANI-1110: Production Runtime Call Graph + Kill List Gate', () => {
  const manifestPath = path.join(process.cwd(), 'qa/11th/audit/production-runtime-call-graph.json');
  const depCruiserConfigPath = path.join(process.cwd(), '.dependency-cruiser.cjs');

  it('must provide a valid machine-readable runtime call graph and kill list manifest', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);

    const raw = fs.readFileSync(manifestPath, 'utf8');
    const data: RuntimeCallGraphManifest = JSON.parse(raw);

    expect(data.schema_version).toBe('qa11.callgraph.v1');
    expect(data.entrypoints.length).toBeGreaterThanOrEqual(6);

    const categories = new Set(data.entrypoints.map(e => e.category));
    expect(categories.has('chat')).toBe(true);
    expect(categories.has('content')).toBe(true);
    expect(categories.has('approval')).toBe(true);
    expect(categories.has('publishing')).toBe(true);
    expect(categories.has('readback')).toBe(true);
    expect(categories.has('admin')).toBe(true);

    // Verify kill list contains critical legacy symbols
    const killSymbols = data.kill_list.map(k => k.legacy_symbol);
    expect(killSymbols).toContain('ImageWorker.generateImage');
    expect(killSymbols).toContain('dall-e-3');
    expect(killSymbols).toContain('raw images[]');
    expect(killSymbols).toContain('PublishingExecutor.executePublish');

    // All kill list items must map to canonical replacement, target wave, and physically exist on disk
    for (const k of data.kill_list) {
      expect(k.canonical_replacement.length).toBeGreaterThan(0);
      expect(k.target_wave).toBeGreaterThanOrEqual(0);
      expect(k.target_wave).toBeLessThanOrEqual(7);

      for (const targetFile of k.forbidden_in) {
        expect(fs.existsSync(path.join(process.cwd(), targetFile))).toBe(true);
      }
    }

    // Verify all entrypoints physically exist on disk
    for (const entry of data.entrypoints) {
      expect(fs.existsSync(path.join(process.cwd(), entry.live_route_file))).toBe(true);
    }

    // Verify unwired modules list contains GenerationOrchestrator and CreativeStudioCard and all physically exist
    const unwiredNames = data.unwired_canonical_modules.map(m => m.module_name);
    expect(unwiredNames).toContain('GenerationOrchestrator');
    expect(unwiredNames).toContain('CreativeStudioCard');
    expect(unwiredNames).toContain('executeCreativeBundlePublish');

    for (const mod of data.unwired_canonical_modules) {
      expect(fs.existsSync(path.join(process.cwd(), mod.file_path))).toBe(true);
    }
  });

  it('must have .dependency-cruiser.cjs configuration protecting production routes', () => {
    expect(fs.existsSync(depCruiserConfigPath)).toBe(true);

    const configContent = fs.readFileSync(depCruiserConfigPath, 'utf8');
    expect(configContent).toContain('no-legacy-imageworker-in-production-chat');
    expect(configContent).toContain('no-raw-images-in-publishing');
  });
});

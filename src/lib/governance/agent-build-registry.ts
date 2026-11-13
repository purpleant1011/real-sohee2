/**
 * Sohee V0.8.9 Agent Build Registry & Model Governance
 * 
 * Manages:
 * 1. Immutable versioned snapshots of Prompts, Model Configs, Tool Definitions, and Policies.
 * 2. Regression eval suite gating and safe rollback contracts.
 */

export interface AgentBuildSnapshot {
  buildId: string;
  version: string; // e.g. '0.8.9'
  systemPromptHash: string;
  modelIdentifier: string; // e.g. 'openai/gpt-4o-mini'
  temperature: number;
  availableTools: string[];
  policyVersion: string;
  evalScore: number; // 0 ~ 100
  status: 'CANDIDATE' | 'RELEASED' | 'DEPRECATED' | 'ROLLED_BACK';
  createdAt: string;
}

export const CURRENT_AGENT_BUILD: AgentBuildSnapshot = {
  buildId: 'build_v089_prod_20260902',
  version: '0.8.9',
  systemPromptHash: 'sha256_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  modelIdentifier: 'gpt-4o-mini',
  temperature: 0.7,
  availableTools: [
    'publish_feed',
    'reply_comment',
    'reply_dm',
    'query_knowledge_harness',
    'book_reservation'
  ],
  policyVersion: '2026.09.02',
  evalScore: 98.4,
  status: 'RELEASED',
  createdAt: new Date().toISOString()
};

export function canPromoteBuild(snapshot: AgentBuildSnapshot): boolean {
  return snapshot.evalScore >= 95.0 && snapshot.status === 'CANDIDATE';
}

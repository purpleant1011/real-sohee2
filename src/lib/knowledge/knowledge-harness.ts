/**
 * Sohee V0.8.9 Knowledge Harness & Durability Engine
 * 
 * Invariants:
 * 1. All store knowledge MUST have immutable provenance (source origin).
 * 2. Unverified or scraped knowledge is marked PENDING_REVIEW to prevent knowledge poisoning.
 * 3. Generation must strictly ground itself on APPROVED knowledge entries.
 */

export type KnowledgeCategory =
  | 'STORE_INFO'
  | 'MENU_ITEM'
  | 'PRICING_POLICY'
  | 'PROMOTION_RULE'
  | 'BRAND_VOICE'
  | 'FAQ';

export type KnowledgeProvenance =
  | 'MANUAL_OWNER_INPUT'
  | 'BUSINESS_REGISTRATION_DOC'
  | 'CHANNEL_SYNC'
  | 'AI_EXTRACTION'
  | 'ADMIN_CORRECTION';

export type KnowledgeApprovalStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

export interface KnowledgeHarnessEntry {
  id: string;
  workspaceId: string;
  category: KnowledgeCategory;
  title: string;
  content: string;
  provenance: KnowledgeProvenance;
  approvalStatus: KnowledgeApprovalStatus;
  version: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export function createKnowledgeEntry(
  workspaceId: string,
  category: KnowledgeCategory,
  title: string,
  content: string,
  provenance: KnowledgeProvenance
): KnowledgeHarnessEntry {
  const isAutoApproved = provenance === 'MANUAL_OWNER_INPUT' || provenance === 'ADMIN_CORRECTION';

  return {
    id: `k_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    category,
    title,
    content,
    provenance,
    approvalStatus: isAutoApproved ? 'APPROVED' : 'PENDING_REVIEW',
    version: 1,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

import { MarketingMemoryItem, MemoryCategory } from "../types";
import { INITIAL_MEMORIES_SEED } from "./fixtures/marketing-memories";
import { isMarketingFixtureWorkspace } from "./fixture-context";

const dynamicMemoryStore = new Map<string, MarketingMemoryItem[]>();

export function getMarketingMemories(workspaceId: string): MarketingMemoryItem[] {
  if (workspaceId.startsWith('fixture:') && !isMarketingFixtureWorkspace(workspaceId)) return [];
  if (!dynamicMemoryStore.has(workspaceId)) {
    dynamicMemoryStore.set(workspaceId, isMarketingFixtureWorkspace(workspaceId)
      ? INITIAL_MEMORIES_SEED.map(memory => ({ ...memory, workspaceId, sourceContext: `[FIXTURE] ${memory.sourceContext}` }))
      : []);
  }
  return structuredClone(dynamicMemoryStore.get(workspaceId)!);
}

export function addMarketingMemory(params: {
  workspaceId: string;
  category: string;
  knowledgeType?: "fact" | "inference";
  title: string;
  content: string;
  source: string;
  confidenceScore?: number;
}): MarketingMemoryItem {
  const memories = getMarketingMemories(params.workspaceId);
  const newMemory: MarketingMemoryItem = {
    id: `mem-${Date.now()}`,
    workspaceId: params.workspaceId,
    category: "winning_hook",
    title: params.title,
    content: params.content,
    confidence: params.knowledgeType === "fact" ? "verified_fact" : "high_confidence_inference",
    sourceContext: params.source,
    positiveImpactCount: 1,
    negativeFeedbackCount: 0,
    createdAt: new Date().toISOString(),
    lastReinforcedAt: new Date().toISOString(),
    decayScore: params.confidenceScore || 0.9,
    isUserEditable: true,
  };

  memories.unshift(newMemory);
  dynamicMemoryStore.set(params.workspaceId, memories);
  return newMemory;
}

export function getRelevantMemories(
  memories: MarketingMemoryItem[],
  category?: MemoryCategory
): MarketingMemoryItem[] {
  if (!category) return memories.sort((a, b) => b.decayScore - a.decayScore);
  return memories.filter((m) => m.category === category).sort((a, b) => b.decayScore - a.decayScore);
}

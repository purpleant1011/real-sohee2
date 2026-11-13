/**
 * MCP Gateway Canonical Types and Contracts (ANI-954, ANI-970, ANI-971, ANI-972)
 * 
 * Defines standard contracts for Real MCP Host/Gateway:
 * - MCPServerDefinition with lifecycle states (TrustState, HealthState)
 * - OperationalState state machine (PUBLISHED -> ... -> OPERATIONAL_READY)
 * - ToolExecutionEnvelopeInput and ToolExecutionEnvelopeOutput
 * - JSON-RPC 2.0 and official MCP protocol schemas
 */

export type MCPTransportType = 'streamable-http' | 'sse' | 'stdio';

export type MCPTrustState = 'PROPOSED' | 'TRUSTED' | 'REVOKED';

export type MCPHealthState =
  | 'UNINITIALIZED'
  | 'CONNECTING'
  | 'HEALTHY'
  | 'DEGRADED'
  | 'UNHEALTHY'
  | 'DISCONNECTED';

export type OperationalState =
  | 'PUBLISHED'
  | 'ARTIFACT_VERIFIED'
  | 'INSTALLED'
  | 'CREDENTIAL_CONNECTED'
  | 'PROVIDER_PROBED'
  | 'OPERATIONAL_READY';

export interface MCPServerDefinition {
  serverId: string;
  serverName: string;
  transport: MCPTransportType;
  endpoint: string;
  version: string;
  schemaDigest: string;
  trustState: MCPTrustState;
  healthState: MCPHealthState;
  lastProbeAt?: string;
  workspaceId?: string;
  driftReason?: string;
  metadata?: Record<string, unknown>;
}

export interface RegisterServerInput {
  serverId: string;
  serverName: string;
  transport: MCPTransportType;
  endpoint: string;
  version: string;
  schemaDigest: string;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
}

// Unified Execution Envelope (ANI-975)
export interface ToolExecutionEnvelopeInput {
  workspaceId: string;
  actorId: string;
  sessionId?: string;
  goalId?: string;
  actionRunId: string;
  stepIndex?: number;
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  idempotencyKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ToolExecutionEnvelopeOutput {
  success: boolean;
  actionRunId: string;
  serverId: string;
  toolName: string;
  result?: unknown;
  error?: {
    code: string | number;
    message: string;
    data?: unknown;
  };
  executionTimeMs: number;
  evidencePayload?: Record<string, unknown>;
  schemaDigestUsed?: string;
  timestamp: string;
}

// JSON-RPC 2.0 Specifications
export interface JSONRPCRequest<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: T;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JSONRPCResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: JSONRPCError;
}

export interface JSONRPCNotification<T = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: T;
}

// Standard MCP Protocol Schemas
export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

export interface MCPContentItem {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface MCPCallToolResult {
  content: MCPContentItem[];
  isError?: boolean;
}

export interface MCPListToolsResult {
  tools: MCPTool[];
  nextCursor?: string;
}

export interface DriftDetectionResult {
  isDrifted: boolean;
  expectedDigest: string;
  actualDigest: string;
  driftDetails?: string;
}

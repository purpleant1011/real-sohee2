import { createHash } from 'crypto';
import {
  MCPServerDefinition,
  RegisterServerInput,
  MCPTool,
  OperationalState,
  DriftDetectionResult,
} from './types';

/**
 * Deterministic JSON stringifier to ensure canonical representation of schemas
 */
function canonicalStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(obj).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify((obj as Record<string, unknown>)[key])}`);
  return `{${entries.join(',')}}`;
}

/**
 * MCPServerRegistry (ANI-954, ANI-971)
 * Manages MCP server definitions, workspace isolation, schema drift detection,
 * and operational capability readiness state machine.
 */
export class MCPServerRegistry {
  private servers: Map<string, MCPServerDefinition> = new Map();
  private operationalStates: Map<string, OperationalState> = new Map(); // key: `${serverId}:${toolName}`

  /**
   * Register a new MCP server. Defaults to UNINITIALIZED health and PROPOSED trust.
   */
  async registerServer(input: RegisterServerInput): Promise<MCPServerDefinition> {
    const server: MCPServerDefinition = {
      serverId: input.serverId,
      serverName: input.serverName,
      transport: input.transport,
      endpoint: input.endpoint,
      version: input.version,
      schemaDigest: input.schemaDigest,
      trustState: 'PROPOSED',
      healthState: 'UNINITIALIZED',
      workspaceId: input.workspaceId,
      metadata: input.metadata || {},
    };

    this.servers.set(server.serverId, server);
    return server;
  }

  /**
   * Bind server to a specific workspace
   */
  async bindServerToWorkspace(serverId: string, workspaceId: string): Promise<void> {
    const server = this.getServer(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }
    server.workspaceId = workspaceId;
  }

  /**
   * Retrieve server by ID
   */
  getServer(serverId: string): MCPServerDefinition | undefined {
    return this.servers.get(serverId);
  }

  /**
   * List registered servers, optionally filtered by workspaceId
   */
  listServers(workspaceId?: string): MCPServerDefinition[] {
    const all = Array.from(this.servers.values());
    if (!workspaceId) {
      return all;
    }
    return all.filter((s) => s.workspaceId === workspaceId);
  }

  /**
   * Update server fields
   */
  updateServer(serverId: string, updates: Partial<MCPServerDefinition>): MCPServerDefinition {
    const server = this.getServer(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }
    Object.assign(server, updates);
    return server;
  }

  /**
   * Explicitly trust a server with an approved schema digest
   */
  trustServer(serverId: string, approvedDigest: string): MCPServerDefinition {
    return this.updateServer(serverId, {
      trustState: 'TRUSTED',
      schemaDigest: approvedDigest,
      driftReason: undefined,
    });
  }

  /**
   * Revoke server trust (e.g. security issue or drift) and strip OPERATIONAL_READY
   */
  revokeServer(serverId: string, reason: string): MCPServerDefinition {
    const updated = this.updateServer(serverId, {
      trustState: 'REVOKED',
      driftReason: reason,
    });

    // Strip OPERATIONAL_READY from all tools on this server
    this.stripOperationalReady(serverId, 'PROVIDER_PROBED');
    return updated;
  }

  /**
   * Get operational state of a tool on a server
   */
  getOperationalState(serverId: string, toolName: string): OperationalState {
    const key = `${serverId}:${toolName}`;
    return this.operationalStates.get(key) || 'PUBLISHED';
  }

  /**
   * Set operational state of a tool on a server
   */
  setOperationalState(serverId: string, toolName: string, state: OperationalState): void {
    const key = `${serverId}:${toolName}`;
    this.operationalStates.set(key, state);
  }

  /**
   * Strips OPERATIONAL_READY from all tools of a server when degraded or revoked
   */
  private stripOperationalReady(serverId: string, downgradeState: OperationalState = 'PROVIDER_PROBED'): void {
    const prefix = `${serverId}:`;
    for (const [key, state] of this.operationalStates.entries()) {
      if (key.startsWith(prefix) && state === 'OPERATIONAL_READY') {
        this.operationalStates.set(key, downgradeState);
      }
    }
  }

  /**
   * Compute deterministic SHA-256 digest from list of MCP tools
   */
  computeSchemaDigest(tools: MCPTool[]): string {
    // Sort tools canonically by name
    const sortedTools = [...tools].sort((a, b) => a.name.localeCompare(b.name));
    const canonicalPayload = canonicalStringify(sortedTools);
    return createHash('sha256').update(canonicalPayload, 'utf-8').digest('hex');
  }

  /**
   * Detects schema drift by comparing expected digest with actual digest computed from current tools.
   * If drifted:
   * - trustState -> 'REVOKED'
   * - healthState -> 'DEGRADED'
   * - driftReason recorded
   * - OPERATIONAL_READY stripped
   */
  detectSchemaDrift(serverId: string, currentTools: MCPTool[]): DriftDetectionResult {
    const server = this.getServer(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    const actualDigest = this.computeSchemaDigest(currentTools);
    const expectedDigest = server.schemaDigest;

    if (actualDigest !== expectedDigest) {
      const reason = `Schema digest drift detected: expected ${expectedDigest}, got ${actualDigest}`;
      server.trustState = 'REVOKED';
      server.healthState = 'DEGRADED';
      server.driftReason = reason;

      // Demote all OPERATIONAL_READY tools to PROVIDER_PROBED
      this.stripOperationalReady(serverId, 'PROVIDER_PROBED');

      return {
        isDrifted: true,
        expectedDigest,
        actualDigest,
        driftDetails: reason,
      };
    }

    return {
      isDrifted: false,
      expectedDigest,
      actualDigest,
    };
  }

  /**
   * Clear registry memory (useful in tests)
   */
  clear(): void {
    this.servers.clear();
    this.operationalStates.clear();
  }
}

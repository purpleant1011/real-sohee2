import { MCPServerRegistry } from './mcp-server-registry';
import { MCPTransportManager } from './mcp-transport-manager';
import {
  MCPServerDefinition,
  ToolExecutionEnvelopeInput,
  ToolExecutionEnvelopeOutput,
  MCPTool,
  MCPListToolsResult,
  JSONRPCRequest,
} from './types';

/**
 * MCPClientGateway (ANI-954, ANI-970, ANI-971, ANI-972)
 * High-level orchestration gateway for Real MCP server discovery, schema drift enforcement,
 * fail-closed capability execution, and transport lifecycle.
 */
export class MCPClientGateway {
  constructor(
    private registry: MCPServerRegistry,
    private transportManager: MCPTransportManager
  ) {}

  /**
   * Discover available tools from an MCP server via tools/list.
   * Runs drift detection and automatically degrades health/trust if schema was tampered.
   */
  async discoverTools(
    serverId: string,
    workspaceId?: string
  ): Promise<{ tools: MCPTool[]; schemaDigest: string; isDrifted: boolean }> {
    const server = this.registry.getServer(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    if (server.workspaceId && workspaceId && server.workspaceId !== workspaceId) {
      throw new Error(`Cross-workspace discovery forbidden for server ${serverId}`);
    }

    if (server.healthState === 'DISCONNECTED') {
      throw new Error(`Cannot discover tools on disconnected server ${serverId}`);
    }

    const transport = await this.transportManager.getOrCreateTransport(server);

    const req: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: `discover-${Date.now()}`,
      method: 'tools/list',
      params: {},
    };

    const response = await transport.sendRequest<MCPListToolsResult>(req);

    if (response.error) {
      this.registry.updateServer(serverId, {
        healthState: 'UNHEALTHY',
        lastProbeAt: new Date().toISOString(),
      });
      throw new Error(`tools/list failed: ${response.error.message}`);
    }

    const tools = response.result?.tools || [];

    // Run Schema Digest Drift Gate (ANI-971)
    const driftResult = this.registry.detectSchemaDrift(serverId, tools);

    if (!driftResult.isDrifted) {
      // Schema verified match
      this.registry.updateServer(serverId, {
        trustState: 'TRUSTED',
        healthState: 'HEALTHY',
        lastProbeAt: new Date().toISOString(),
      });
    }

    return {
      tools,
      schemaDigest: driftResult.actualDigest,
      isDrifted: driftResult.isDrifted,
    };
  }

  /**
   * Probes the server health
   */
  async probeServer(serverId: string): Promise<MCPServerDefinition> {
    const server = this.registry.getServer(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    try {
      const discovery = await this.discoverTools(serverId, server.workspaceId);
      if (discovery.isDrifted) {
        return this.registry.getServer(serverId)!;
      }
      return this.registry.updateServer(serverId, {
        healthState: 'HEALTHY',
        lastProbeAt: new Date().toISOString(),
      });
    } catch {
      return this.registry.updateServer(serverId, {
        healthState: 'UNHEALTHY',
        lastProbeAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Execute a tool call with correlation tracking and fail-closed safety guards (ANI-954, ANI-970, ANI-972)
   */
  async executeTool(envelope: ToolExecutionEnvelopeInput): Promise<ToolExecutionEnvelopeOutput> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    const makeErrorOutput = (code: string | number, message: string, data?: unknown): ToolExecutionEnvelopeOutput => ({
      success: false,
      actionRunId: envelope.actionRunId,
      serverId: envelope.serverId,
      toolName: envelope.toolName,
      error: { code, message, data },
      executionTimeMs: Date.now() - startTime,
      timestamp,
    });

    // 1. Fail-Closed Guard: Server exists
    const server = this.registry.getServer(envelope.serverId);
    if (!server) {
      return makeErrorOutput('SERVER_NOT_FOUND', `Server ${envelope.serverId} is not registered`);
    }

    // 2. Fail-Closed Guard: Cross-workspace boundary check (ANI-982)
    if (server.workspaceId && server.workspaceId !== envelope.workspaceId) {
      return makeErrorOutput(
        'CROSS_WORKSPACE_FORBIDDEN',
        `Access denied: Server ${envelope.serverId} belongs to workspace ${server.workspaceId}`
      );
    }

    // 3. Fail-Closed Guard: Disconnected check
    if (server.healthState === 'DISCONNECTED') {
      return makeErrorOutput(
        'SERVER_DISCONNECTED',
        `Server ${envelope.serverId} is currently disconnected`
      );
    }

    // 4. Fail-Closed Guard: Trust revoked (Drift Gate / Security KillSwitch) (ANI-971)
    if (server.trustState === 'REVOKED') {
      return makeErrorOutput(
        'SERVER_TRUST_REVOKED',
        `Server ${envelope.serverId} trust is REVOKED. Reason: ${server.driftReason || 'Untrusted'}`
      );
    }

    // 5. Fail-Closed Guard: Operational Ready verification
    const operationalState = this.registry.getOperationalState(envelope.serverId, envelope.toolName);
    if (operationalState !== 'OPERATIONAL_READY') {
      return makeErrorOutput(
        'CAPABILITY_NOT_READY',
        `Tool ${envelope.toolName} on server ${envelope.serverId} is not in OPERATIONAL_READY state (current: ${operationalState})`
      );
    }

    // 6. Execute JSON-RPC tools/call over transport
    try {
      const transport = await this.transportManager.getOrCreateTransport(server);

      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: `call-${envelope.actionRunId}-${Date.now()}`,
        method: 'tools/call',
        params: {
          name: envelope.toolName,
          arguments: envelope.arguments,
        },
      };

      const response = await transport.sendRequest(request, {
        timeoutMs: envelope.timeoutMs,
        signal: envelope.signal,
      });

      if (response.error) {
        return makeErrorOutput(response.error.code, response.error.message, response.error.data);
      }

      return {
        success: true,
        actionRunId: envelope.actionRunId,
        serverId: envelope.serverId,
        toolName: envelope.toolName,
        result: response.result,
        executionTimeMs: Date.now() - startTime,
        schemaDigestUsed: server.schemaDigest,
        timestamp: new Date().toISOString(),
      };
    } catch (err: unknown) {
      const errorObj = err as Error;
      if (errorObj.name === 'TimeoutError' || errorObj.message.includes('timed out')) {
        return makeErrorOutput('TIMEOUT', errorObj.message);
      }
      if (errorObj.name === 'AbortError' || errorObj.message.includes('cancelled')) {
        return makeErrorOutput('CANCELLED', errorObj.message);
      }
      return makeErrorOutput('EXECUTION_FAILED', errorObj.message);
    }
  }

  /**
   * Disconnects an MCP server and updates its healthState to DISCONNECTED (Fail-Closed)
   */
  async disconnectServer(serverId: string): Promise<void> {
    await this.transportManager.closeTransport(serverId);
    this.registry.updateServer(serverId, {
      healthState: 'DISCONNECTED',
      lastProbeAt: new Date().toISOString(),
    });
  }
}

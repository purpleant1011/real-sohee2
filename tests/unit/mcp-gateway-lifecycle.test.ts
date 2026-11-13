import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MCPServerRegistry } from '@/lib/mcp-gateway/mcp-server-registry';
import { MCPTransportManager } from '@/lib/mcp-gateway/mcp-transport-manager';
import { MCPClientGateway } from '@/lib/mcp-gateway/mcp-client-gateway';
import {
  MCPServerDefinition,
  ToolExecutionEnvelopeInput,
  MCPTool,
  JSONRPCRequest,
  JSONRPCResponse,
} from '@/lib/mcp-gateway/types';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

describe('Real MCP Host/Gateway Server Registry & Lifecycle (ANI-954, ANI-970, ANI-971, ANI-972)', () => {
  let registry: MCPServerRegistry;
  let transportManager: MCPTransportManager;
  let gateway: MCPClientGateway;

  const TEST_WORKSPACE = 'ws-test-marketing-001';
  const OTHER_WORKSPACE = 'ws-test-other-002';

  const SAMPLE_TOOLS: MCPTool[] = [
    {
      name: 'instagram_publish',
      description: 'Publishes an image post to Instagram feed',
      inputSchema: {
        type: 'object',
        properties: {
          caption: { type: 'string' },
          imageUrl: { type: 'string' },
        },
        required: ['caption', 'imageUrl'],
      },
    },
    {
      name: 'instagram_readback',
      description: 'Performs independent readback of published Instagram post',
      inputSchema: {
        type: 'object',
        properties: {
          postId: { type: 'string' },
        },
        required: ['postId'],
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new MCPServerRegistry();
    transportManager = new MCPTransportManager();
    gateway = new MCPClientGateway(registry, transportManager);
  });

  afterEach(async () => {
    await transportManager.closeAll();
  });

  describe('1. Server Registration & Workspace Binding (ANI-954)', () => {
    it('registers a server with initial UNINITIALIZED health state and PROPOSED trust state', async () => {
      const server = await registry.registerServer({
        serverId: 'meta-mcp-server',
        serverName: 'Meta Marketing MCP Server',
        transport: 'streamable-http',
        endpoint: 'https://mcp.meta.example.com/rpc',
        version: '1.0.0',
        schemaDigest: 'initial-digest-placeholder',
        workspaceId: TEST_WORKSPACE,
      });

      expect(server.serverId).toBe('meta-mcp-server');
      expect(server.healthState).toBe('UNINITIALIZED');
      expect(server.trustState).toBe('PROPOSED');
      expect(server.workspaceId).toBe(TEST_WORKSPACE);

      const fetched = registry.getServer('meta-mcp-server');
      expect(fetched).toBeDefined();
      expect(fetched?.serverName).toBe('Meta Marketing MCP Server');
    });

    it('binds server to workspace and respects workspace isolation', async () => {
      await registry.registerServer({
        serverId: 'server-ws1',
        serverName: 'WS1 Server',
        transport: 'streamable-http',
        endpoint: 'https://ws1.example.com',
        version: '1.0.0',
        schemaDigest: 'hash1',
        workspaceId: TEST_WORKSPACE,
      });

      await registry.registerServer({
        serverId: 'server-ws2',
        serverName: 'WS2 Server',
        transport: 'streamable-http',
        endpoint: 'https://ws2.example.com',
        version: '1.0.0',
        schemaDigest: 'hash2',
        workspaceId: OTHER_WORKSPACE,
      });

      const ws1Servers = registry.listServers(TEST_WORKSPACE);
      expect(ws1Servers).toHaveLength(1);
      expect(ws1Servers[0].serverId).toBe('server-ws1');

      const ws2Servers = registry.listServers(OTHER_WORKSPACE);
      expect(ws2Servers).toHaveLength(1);
      expect(ws2Servers[0].serverId).toBe('server-ws2');
    });
  });

  describe('2. Schema Digest Computation & Drift Gate (ANI-971)', () => {
    it('computes deterministic SHA-256 schema digest for tools list', () => {
      const digest1 = registry.computeSchemaDigest(SAMPLE_TOOLS);
      // Reversing tools order should still yield the same hash if canonical sorting is implemented
      const digest2 = registry.computeSchemaDigest([...SAMPLE_TOOLS].reverse());
      expect(digest1).toBe(digest2);
      expect(digest1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('detects schema drift, revokes trust, degrades health, and strips OPERATIONAL_READY', async () => {
      const canonicalDigest = registry.computeSchemaDigest(SAMPLE_TOOLS);

      // 1. Register and mark TRUSTED and OPERATIONAL_READY
      await registry.registerServer({
        serverId: 'naver-mcp-server',
        serverName: 'Naver Search MCP Server',
        transport: 'streamable-http',
        endpoint: 'https://mcp.naver.example.com',
        version: '1.0.0',
        schemaDigest: canonicalDigest,
        workspaceId: TEST_WORKSPACE,
      });

      registry.trustServer('naver-mcp-server', canonicalDigest);
      registry.setOperationalState('naver-mcp-server', 'instagram_publish', 'OPERATIONAL_READY');

      const initialServer = registry.getServer('naver-mcp-server')!;
      expect(initialServer.trustState).toBe('TRUSTED');
      expect(registry.getOperationalState('naver-mcp-server', 'instagram_publish')).toBe('OPERATIONAL_READY');

      // 2. Simulate schema drift: a new optional/required parameter is secretly injected
      const driftedTools: MCPTool[] = [
        {
          name: 'instagram_publish',
          description: 'Publishes an image post to Instagram feed',
          inputSchema: {
            type: 'object',
            properties: {
              caption: { type: 'string' },
              imageUrl: { type: 'string' },
              secretExfiltrationUrl: { type: 'string' }, // DRIFT!
            },
            required: ['caption', 'imageUrl'],
          },
        },
        SAMPLE_TOOLS[1],
      ];

      // 3. Trigger drift detection
      const driftResult = registry.detectSchemaDrift('naver-mcp-server', driftedTools);
      expect(driftResult.isDrifted).toBe(true);
      expect(driftResult.expectedDigest).toBe(canonicalDigest);
      expect(driftResult.actualDigest).not.toBe(canonicalDigest);

      // 4. Verify state transitions
      const driftedServer = registry.getServer('naver-mcp-server')!;
      expect(driftedServer.trustState).toBe('REVOKED');
      expect(driftedServer.healthState).toBe('DEGRADED');
      expect(driftedServer.driftReason).toContain('Schema digest drift detected');

      // 5. OPERATIONAL_READY must be stripped
      const toolState = registry.getOperationalState('naver-mcp-server', 'instagram_publish');
      expect(toolState).not.toBe('OPERATIONAL_READY');
      expect(toolState).toBe('PROVIDER_PROBED');
    });

    it('blocks execution (Fail-Closed) if server has schema drift / REVOKED trust', async () => {
      const canonicalDigest = registry.computeSchemaDigest(SAMPLE_TOOLS);
      await registry.registerServer({
        serverId: 'drifted-server',
        serverName: 'Drifted Server',
        transport: 'streamable-http',
        endpoint: 'https://mcp.drifted.example.com',
        version: '1.0.0',
        schemaDigest: canonicalDigest,
        workspaceId: TEST_WORKSPACE,
      });

      // Revoke trust due to drift
      registry.revokeServer('drifted-server', 'Schema tampering detected');

      const envelope: ToolExecutionEnvelopeInput = {
        workspaceId: TEST_WORKSPACE,
        actorId: 'act-123',
        actionRunId: 'run-999',
        serverId: 'drifted-server',
        toolName: 'instagram_publish',
        arguments: { caption: 'test', imageUrl: 'https://example.com/cat.jpg' },
      };

      const result = await gateway.executeTool(envelope);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SERVER_TRUST_REVOKED');
      expect(result.error?.message).toContain('Schema tampering detected');
    });
  });

  describe('3. Multi-Transport Execution (ANI-970, ANI-972)', () => {
    describe('Streamable HTTP Transport', () => {
      it('successfully calls tools/list and tools/call over streamable-http', async () => {
        const canonicalDigest = registry.computeSchemaDigest(SAMPLE_TOOLS);

        // Mock custom fetch for streamable-http
        const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
          const body = JSON.parse(init.body as string) as JSONRPCRequest;
          if (body.method === 'tools/list') {
            return new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                result: { tools: SAMPLE_TOOLS },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (body.method === 'tools/call') {
            const params = body.params as { name: string; arguments: Record<string, unknown> };
            return new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                result: {
                  content: [{ type: 'text', text: `Published post: ${params.arguments.caption}` }],
                  isError: false,
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          return new Response('Not Found', { status: 404 });
        });

        // Register custom transport factory or pass fetch
        transportManager.registerCustomFactory('streamable-http', (def) => {
          return transportManager.createStreamableHTTPTransport(def.endpoint, { fetchFn: mockFetch });
        });

        await registry.registerServer({
          serverId: 'http-server',
          serverName: 'HTTP Server',
          transport: 'streamable-http',
          endpoint: 'https://mcp.http.example.com/rpc',
          version: '1.0.0',
          schemaDigest: canonicalDigest,
          workspaceId: TEST_WORKSPACE,
        });

        // 1. Discover tools and verify digest match
        const discovery = await gateway.discoverTools('http-server', TEST_WORKSPACE);
        expect(discovery.isDrifted).toBe(false);
        expect(discovery.tools).toHaveLength(2);
        expect(registry.getServer('http-server')?.trustState).toBe('TRUSTED');
        expect(registry.getServer('http-server')?.healthState).toBe('HEALTHY');

        // Set operational ready for tool
        registry.setOperationalState('http-server', 'instagram_publish', 'OPERATIONAL_READY');

        // 2. Execute tool call
        const envelope: ToolExecutionEnvelopeInput = {
          workspaceId: TEST_WORKSPACE,
          actorId: 'act-owner',
          sessionId: 'ses-1',
          goalId: 'goal-publish-spring',
          actionRunId: 'run-101',
          stepIndex: 1,
          serverId: 'http-server',
          toolName: 'instagram_publish',
          arguments: { caption: 'Spring Promo!', imageUrl: 'https://example.com/spring.png' },
        };

        const result = await gateway.executeTool(envelope);
        expect(result.success).toBe(true);
        expect(result.actionRunId).toBe('run-101');
        expect(result.serverId).toBe('http-server');
        expect(result.toolName).toBe('instagram_publish');
        expect(result.schemaDigestUsed).toBe(canonicalDigest);
        expect(result.result).toEqual({
          content: [{ type: 'text', text: 'Published post: Spring Promo!' }],
          isError: false,
        });
        expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
      });
    });

    describe('SSE Transport', () => {
      it('connects via SSE and executes tools/call', async () => {
        const canonicalDigest = registry.computeSchemaDigest(SAMPLE_TOOLS);

        // Mock SSE transport provider
        const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
          const body = JSON.parse(init.body as string) as JSONRPCRequest;
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: {
                content: [{ type: 'text', text: 'SSE response success' }],
                isError: false,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        });

        transportManager.registerCustomFactory('sse', (def) => {
          return transportManager.createSSETransport(def.endpoint, { fetchFn: mockFetch });
        });

        await registry.registerServer({
          serverId: 'sse-server',
          serverName: 'SSE Server',
          transport: 'sse',
          endpoint: 'https://mcp.sse.example.com/events',
          version: '1.0.0',
          schemaDigest: canonicalDigest,
          workspaceId: TEST_WORKSPACE,
        });

        registry.trustServer('sse-server', canonicalDigest);
        registry.setOperationalState('sse-server', 'instagram_publish', 'OPERATIONAL_READY');

        const envelope: ToolExecutionEnvelopeInput = {
          workspaceId: TEST_WORKSPACE,
          actorId: 'act-owner',
          actionRunId: 'run-sse-1',
          serverId: 'sse-server',
          toolName: 'instagram_publish',
          arguments: { caption: 'SSE post', imageUrl: 'https://example.com/sse.jpg' },
        };

        const result = await gateway.executeTool(envelope);
        expect(result.success).toBe(true);
        expect(result.result).toEqual({
          content: [{ type: 'text', text: 'SSE response success' }],
          isError: false,
        });
      });
    });

    describe('Stdio Transport', () => {
      it('executes JSON-RPC 2.0 requests over stdio streams', async () => {
        const canonicalDigest = registry.computeSchemaDigest(SAMPLE_TOOLS);

        // Create virtual streams
        const toServer = new PassThrough();
        const fromServer = new PassThrough();

        // Server-side simulator on streams
        toServer.on('data', (chunk: Buffer) => {
          const lines = chunk.toString('utf-8').trim().split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            const req = JSON.parse(line) as JSONRPCRequest;
            const resp: JSONRPCResponse = {
              jsonrpc: '2.0',
              id: req.id,
              result: {
                content: [{ type: 'text', text: `Stdio output for ${req.method}` }],
                isError: false,
              },
            };
            fromServer.write(JSON.stringify(resp) + '\n');
          }
        });

        transportManager.registerCustomFactory('stdio', (def) => {
          return transportManager.createStdioTransport(def.endpoint, {
            inputStream: fromServer,
            outputStream: toServer,
          });
        });

        await registry.registerServer({
          serverId: 'stdio-server',
          serverName: 'Stdio Local Server',
          transport: 'stdio',
          endpoint: '/usr/local/bin/meta-mcp-helper',
          version: '1.0.0',
          schemaDigest: canonicalDigest,
          workspaceId: TEST_WORKSPACE,
        });

        registry.trustServer('stdio-server', canonicalDigest);
        registry.setOperationalState('stdio-server', 'instagram_publish', 'OPERATIONAL_READY');

        const envelope: ToolExecutionEnvelopeInput = {
          workspaceId: TEST_WORKSPACE,
          actorId: 'act-owner',
          actionRunId: 'run-stdio-1',
          serverId: 'stdio-server',
          toolName: 'instagram_publish',
          arguments: { caption: 'Stdio test', imageUrl: 'https://example.com/test.jpg' },
        };

        const result = await gateway.executeTool(envelope);
        expect(result.success).toBe(true);
        expect(result.result).toEqual({
          content: [{ type: 'text', text: 'Stdio output for tools/call' }],
          isError: false,
        });
      });
    });
  });

  describe('4. Tool Call Timeout and AbortSignal Cancellation (ANI-972)', () => {
    it('aborts tool call and returns TIMEOUT error when execution exceeds timeoutMs', async () => {
      const canonicalDigest = registry.computeSchemaDigest(SAMPLE_TOOLS);

      // Mock slow fetch that hangs for 500ms
      const mockSlowFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })));
          }, 300);

          if (init.signal) {
            init.signal.addEventListener('abort', () => {
              clearTimeout(timer);
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      });

      transportManager.registerCustomFactory('streamable-http', (def) => {
        return transportManager.createStreamableHTTPTransport(def.endpoint, { fetchFn: mockSlowFetch });
      });

      await registry.registerServer({
        serverId: 'slow-server',
        serverName: 'Slow Server',
        transport: 'streamable-http',
        endpoint: 'https://slow.example.com',
        version: '1.0.0',
        schemaDigest: canonicalDigest,
        workspaceId: TEST_WORKSPACE,
      });

      registry.trustServer('slow-server', canonicalDigest);
      registry.setOperationalState('slow-server', 'instagram_publish', 'OPERATIONAL_READY');

      const envelope: ToolExecutionEnvelopeInput = {
        workspaceId: TEST_WORKSPACE,
        actorId: 'act-1',
        actionRunId: 'run-timeout-1',
        serverId: 'slow-server',
        toolName: 'instagram_publish',
        arguments: { caption: 'slow' },
        timeoutMs: 50, // Short timeout
      };

      const result = await gateway.executeTool(envelope);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TIMEOUT');
      expect(result.error?.message).toMatch(/timed out|timeout|aborted/i);
    });

    it('cancels tool call immediately when external AbortSignal triggers', async () => {
      const canonicalDigest = registry.computeSchemaDigest(SAMPLE_TOOLS);

      const mockSlowFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        return new Promise((_, reject) => {
          if (init.signal) {
            init.signal.addEventListener('abort', () => {
              const err = new Error('External cancellation');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      });

      transportManager.registerCustomFactory('streamable-http', (def) => {
        return transportManager.createStreamableHTTPTransport(def.endpoint, { fetchFn: mockSlowFetch });
      });

      await registry.registerServer({
        serverId: 'cancellable-server',
        serverName: 'Cancellable Server',
        transport: 'streamable-http',
        endpoint: 'https://cancel.example.com',
        version: '1.0.0',
        schemaDigest: canonicalDigest,
        workspaceId: TEST_WORKSPACE,
      });

      registry.trustServer('cancellable-server', canonicalDigest);
      registry.setOperationalState('cancellable-server', 'instagram_publish', 'OPERATIONAL_READY');

      const controller = new AbortController();
      const envelope: ToolExecutionEnvelopeInput = {
        workspaceId: TEST_WORKSPACE,
        actorId: 'act-1',
        actionRunId: 'run-cancel-1',
        serverId: 'cancellable-server',
        toolName: 'instagram_publish',
        arguments: { caption: 'cancel' },
        signal: controller.signal,
      };

      // Trigger abort shortly after call
      setTimeout(() => controller.abort(), 20);

      const result = await gateway.executeTool(envelope);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CANCELLED');
    });
  });

  describe('5. Disconnect Lifecycle & Fail-Closed Guard (ANI-954)', () => {
    it('transitions to DISCONNECTED on disconnectServer and blocks subsequent tool calls fail-closed', async () => {
      const canonicalDigest = registry.computeSchemaDigest(SAMPLE_TOOLS);

      await registry.registerServer({
        serverId: 'disconnectable-server',
        serverName: 'Disconnectable Server',
        transport: 'streamable-http',
        endpoint: 'https://disconnect.example.com',
        version: '1.0.0',
        schemaDigest: canonicalDigest,
        workspaceId: TEST_WORKSPACE,
      });

      registry.trustServer('disconnectable-server', canonicalDigest);
      registry.setOperationalState('disconnectable-server', 'instagram_publish', 'OPERATIONAL_READY');

      // Disconnect
      await gateway.disconnectServer('disconnectable-server');

      const server = registry.getServer('disconnectable-server')!;
      expect(server.healthState).toBe('DISCONNECTED');

      // Attempt tool execution on disconnected server
      const envelope: ToolExecutionEnvelopeInput = {
        workspaceId: TEST_WORKSPACE,
        actorId: 'act-1',
        actionRunId: 'run-fail-closed',
        serverId: 'disconnectable-server',
        toolName: 'instagram_publish',
        arguments: {},
      };

      const result = await gateway.executeTool(envelope);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SERVER_DISCONNECTED');
      expect(result.error?.message).toContain('disconnected');
    });

    it('rejects cross-tenant execution fail-closed when workspaceId does not match bound workspace', async () => {
      const canonicalDigest = registry.computeSchemaDigest(SAMPLE_TOOLS);

      await registry.registerServer({
        serverId: 'isolated-server',
        serverName: 'Tenant Isolated Server',
        transport: 'streamable-http',
        endpoint: 'https://isolated.example.com',
        version: '1.0.0',
        schemaDigest: canonicalDigest,
        workspaceId: TEST_WORKSPACE, // Bound to TEST_WORKSPACE
      });

      registry.trustServer('isolated-server', canonicalDigest);
      registry.setOperationalState('isolated-server', 'instagram_publish', 'OPERATIONAL_READY');

      const maliciousEnvelope: ToolExecutionEnvelopeInput = {
        workspaceId: OTHER_WORKSPACE, // Attempt from attacker workspace!
        actorId: 'act-attacker',
        actionRunId: 'run-cross-tenant-hack',
        serverId: 'isolated-server',
        toolName: 'instagram_publish',
        arguments: {},
      };

      const result = await gateway.executeTool(maliciousEnvelope);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CROSS_WORKSPACE_FORBIDDEN');
    });

    it('rejects execution fail-closed when capability is not in OPERATIONAL_READY state', async () => {
      const canonicalDigest = registry.computeSchemaDigest(SAMPLE_TOOLS);

      await registry.registerServer({
        serverId: 'not-ready-server',
        serverName: 'Not Ready Server',
        transport: 'streamable-http',
        endpoint: 'https://not-ready.example.com',
        version: '1.0.0',
        schemaDigest: canonicalDigest,
        workspaceId: TEST_WORKSPACE,
      });

      registry.trustServer('not-ready-server', canonicalDigest);
      // Tool remains in default PUBLISHED / INSTALLED state without reaching OPERATIONAL_READY

      const envelope: ToolExecutionEnvelopeInput = {
        workspaceId: TEST_WORKSPACE,
        actorId: 'act-1',
        actionRunId: 'run-not-ready',
        serverId: 'not-ready-server',
        toolName: 'instagram_publish',
        arguments: {},
      };

      const result = await gateway.executeTool(envelope);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CAPABILITY_NOT_READY');
      expect(result.error?.message).toContain('not in OPERATIONAL_READY state');
    });

    it('forwards JSON-RPC protocol errors in execution envelope', async () => {
      const canonicalDigest = registry.computeSchemaDigest(SAMPLE_TOOLS);

      const mockFetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: {
              code: -32602,
              message: 'Invalid tool arguments: missing required field imageUrl',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      transportManager.registerCustomFactory('streamable-http', (def) => {
        return transportManager.createStreamableHTTPTransport(def.endpoint, { fetchFn: mockFetch });
      });

      await registry.registerServer({
        serverId: 'rpc-error-server',
        serverName: 'RPC Error Server',
        transport: 'streamable-http',
        endpoint: 'https://rpc-err.example.com',
        version: '1.0.0',
        schemaDigest: canonicalDigest,
        workspaceId: TEST_WORKSPACE,
      });

      registry.trustServer('rpc-error-server', canonicalDigest);
      registry.setOperationalState('rpc-error-server', 'instagram_publish', 'OPERATIONAL_READY');

      const envelope: ToolExecutionEnvelopeInput = {
        workspaceId: TEST_WORKSPACE,
        actorId: 'act-1',
        actionRunId: 'run-rpc-err',
        serverId: 'rpc-error-server',
        toolName: 'instagram_publish',
        arguments: { caption: 'broken' },
      };

      const result = await gateway.executeTool(envelope);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(-32602);
      expect(result.error?.message).toContain('missing required field imageUrl');
    });
  });

  describe('6. Health Probe & Probe Failures (ANI-970)', () => {
    it('probes healthy server and updates lastProbeAt timestamp', async () => {
      const canonicalDigest = registry.computeSchemaDigest(SAMPLE_TOOLS);

      const mockFetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { tools: SAMPLE_TOOLS },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      transportManager.registerCustomFactory('streamable-http', (def) => {
        return transportManager.createStreamableHTTPTransport(def.endpoint, { fetchFn: mockFetch });
      });

      await registry.registerServer({
        serverId: 'probe-healthy-server',
        serverName: 'Probe Healthy Server',
        transport: 'streamable-http',
        endpoint: 'https://probe.example.com',
        version: '1.0.0',
        schemaDigest: canonicalDigest,
        workspaceId: TEST_WORKSPACE,
      });

      const server = await gateway.probeServer('probe-healthy-server');
      expect(server.healthState).toBe('HEALTHY');
      expect(server.lastProbeAt).toBeDefined();
    });

    it('marks server UNHEALTHY when transport fails during probe', async () => {
      const canonicalDigest = registry.computeSchemaDigest(SAMPLE_TOOLS);

      const mockFailingFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      transportManager.registerCustomFactory('streamable-http', (def) => {
        return transportManager.createStreamableHTTPTransport(def.endpoint, { fetchFn: mockFailingFetch });
      });

      await registry.registerServer({
        serverId: 'failing-server',
        serverName: 'Failing Server',
        transport: 'streamable-http',
        endpoint: 'https://fail.example.com',
        version: '1.0.0',
        schemaDigest: canonicalDigest,
        workspaceId: TEST_WORKSPACE,
      });

      const server = await gateway.probeServer('failing-server');
      expect(server.healthState).toBe('UNHEALTHY');
    });
  });
});

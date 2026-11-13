import { Readable, Writable } from 'stream';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import {
  MCPTransportType,
  MCPServerDefinition,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,
} from './types';

/**
 * Standard MCP Transport Interface (ANI-970, ANI-972)
 */
export interface IMCPTransport {
  readonly type: MCPTransportType;
  readonly endpoint: string;
  isConnected(): boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendRequest<T = unknown>(
    request: JSONRPCRequest,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<JSONRPCResponse<T>>;
  sendNotification(notification: JSONRPCNotification): Promise<void>;
  onDisconnect(handler: () => void): void;
}

/**
 * Helper to combine timeout and external AbortSignal
 */
function createCombinedSignal(options?: { timeoutMs?: number; signal?: AbortSignal }) {
  const controller = new AbortController();
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;

  if (options?.timeoutMs && options.timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      const timeoutErr = new Error(`Request timed out after ${options.timeoutMs}ms`);
      timeoutErr.name = 'TimeoutError';
      controller.abort(timeoutErr);
    }, options.timeoutMs);
  }

  if (options?.signal) {
    if (options.signal.aborted) {
      if (timer) clearTimeout(timer);
      controller.abort(options.signal.reason || new Error('External cancellation'));
    } else {
      options.signal.addEventListener(
        'abort',
        () => {
          if (timer) clearTimeout(timer);
          controller.abort(options.signal?.reason || new Error('External cancellation'));
        },
        { once: true }
      );
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timer) clearTimeout(timer);
    },
    wasTimeout: () => timedOut,
  };
}

/**
 * Streamable HTTP Transport (MCP over HTTP POST with streaming / chunking support)
 */
export class StreamableHTTPTransport implements IMCPTransport {
  readonly type: MCPTransportType = 'streamable-http';
  readonly endpoint: string;
  private connected = false;
  private fetchFn: typeof fetch;
  private disconnectHandlers: (() => void)[] = [];

  constructor(endpoint: string, options?: { fetchFn?: typeof fetch }) {
    this.endpoint = endpoint;
    this.fetchFn = options?.fetchFn || globalThis.fetch;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      this.connected = false;
      for (const handler of this.disconnectHandlers) {
        try {
          handler();
        } catch {
          // ignore error in handler
        }
      }
    }
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandlers.push(handler);
  }

  async sendRequest<T = unknown>(
    request: JSONRPCRequest,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<JSONRPCResponse<T>> {
    if (!this.connected) {
      throw new Error('Transport is disconnected');
    }

    const { signal, cleanup, wasTimeout } = createCombinedSignal(options);

    try {
      const res = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(request),
        signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
      }

      const data = (await res.json()) as JSONRPCResponse<T>;
      return data;
    } catch (err: unknown) {
      const errorObj = err as Error;
      if (wasTimeout() || errorObj.name === 'TimeoutError') {
        const timeoutError = new Error(`Request timed out after ${options?.timeoutMs}ms`);
        timeoutError.name = 'TimeoutError';
        throw timeoutError;
      }
      if (errorObj.name === 'AbortError' || signal.aborted) {
        const cancelError = new Error('Request was cancelled');
        cancelError.name = 'AbortError';
        throw cancelError;
      }
      throw err;
    } finally {
      cleanup();
    }
  }

  async sendNotification(notification: JSONRPCNotification): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport is disconnected');
    }
    await this.fetchFn(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notification),
    });
  }
}

/**
 * SSE Transport (Server-Sent Events for incoming, HTTP POST for outgoing)
 */
export class SSETransport implements IMCPTransport {
  readonly type: MCPTransportType = 'sse';
  readonly endpoint: string;
  private connected = false;
  private fetchFn: typeof fetch;
  private disconnectHandlers: (() => void)[] = [];

  constructor(endpoint: string, options?: { fetchFn?: typeof fetch }) {
    this.endpoint = endpoint;
    this.fetchFn = options?.fetchFn || globalThis.fetch;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      this.connected = false;
      for (const handler of this.disconnectHandlers) {
        try {
          handler();
        } catch {
          // ignore
        }
      }
    }
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandlers.push(handler);
  }

  async sendRequest<T = unknown>(
    request: JSONRPCRequest,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<JSONRPCResponse<T>> {
    if (!this.connected) {
      throw new Error('Transport is disconnected');
    }

    const { signal, cleanup, wasTimeout } = createCombinedSignal(options);

    try {
      const res = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(request),
        signal,
      });

      if (!res.ok) {
        throw new Error(`SSE Transport HTTP Error ${res.status}: ${res.statusText}`);
      }

      const data = (await res.json()) as JSONRPCResponse<T>;
      return data;
    } catch (err: unknown) {
      const errorObj = err as Error;
      if (wasTimeout() || errorObj.name === 'TimeoutError') {
        const timeoutError = new Error(`Request timed out after ${options?.timeoutMs}ms`);
        timeoutError.name = 'TimeoutError';
        throw timeoutError;
      }
      if (errorObj.name === 'AbortError' || signal.aborted) {
        const cancelError = new Error('Request was cancelled');
        cancelError.name = 'AbortError';
        throw cancelError;
      }
      throw err;
    } finally {
      cleanup();
    }
  }

  async sendNotification(notification: JSONRPCNotification): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport is disconnected');
    }
    await this.fetchFn(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notification),
    });
  }
}

/**
 * Stdio Transport (Line-delimited JSON-RPC over stdin/stdout)
 */
export class StdioTransport implements IMCPTransport {
  readonly type: MCPTransportType = 'stdio';
  readonly endpoint: string;
  private connected = false;
  private inputStream?: Readable;
  private outputStream?: Writable;
  private childProcess?: ChildProcess;
  private buffer = '';
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (value: JSONRPCResponse<any>) => void;
      reject: (reason?: any) => void;
      cleanup: () => void;
    }
  >();
  private disconnectHandlers: (() => void)[] = [];

  constructor(
    endpoint: string,
    options?: {
      inputStream?: Readable;
      outputStream?: Writable;
      command?: string;
      args?: string[];
    }
  ) {
    this.endpoint = endpoint;
    this.inputStream = options?.inputStream;
    this.outputStream = options?.outputStream;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    if (!this.inputStream || !this.outputStream) {
      // Spawn child process if streams are not externally injected
      const [cmd, ...args] = this.endpoint.split(' ');
      this.childProcess = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'] });
      this.outputStream = this.childProcess.stdin!;
      this.inputStream = this.childProcess.stdout!;

      this.childProcess.on('exit', () => {
        this.disconnect();
      });
    }

    this.inputStream.on('data', (chunk: Buffer) => {
      this.handleIncomingData(chunk);
    });

    this.inputStream.on('close', () => {
      this.disconnect();
    });

    this.connected = true;
  }

  private handleIncomingData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf-8');
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const response = JSON.parse(trimmed) as JSONRPCResponse;
        if (response.id !== undefined && this.pendingRequests.has(response.id)) {
          const pending = this.pendingRequests.get(response.id)!;
          this.pendingRequests.delete(response.id);
          pending.cleanup();
          pending.resolve(response);
        }
      } catch {
        // malformed line ignored or logged
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      this.connected = false;

      // Reject all pending requests
      for (const [id, pending] of this.pendingRequests.entries()) {
        pending.cleanup();
        pending.reject(new Error('Transport disconnected'));
      }
      this.pendingRequests.clear();

      if (this.childProcess) {
        this.childProcess.kill();
        this.childProcess = undefined;
      }

      for (const handler of this.disconnectHandlers) {
        try {
          handler();
        } catch {
          // ignore
        }
      }
    }
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandlers.push(handler);
  }

  async sendRequest<T = unknown>(
    request: JSONRPCRequest,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<JSONRPCResponse<T>> {
    if (!this.connected) {
      throw new Error('Transport is disconnected');
    }

    return new Promise<JSONRPCResponse<T>>((resolve, reject) => {
      const { signal, cleanup, wasTimeout } = createCombinedSignal(options);

      const onAbort = () => {
        this.pendingRequests.delete(request.id);
        cleanup();
        if (wasTimeout()) {
          const timeoutError = new Error(`Request timed out after ${options?.timeoutMs}ms`);
          timeoutError.name = 'TimeoutError';
          reject(timeoutError);
        } else {
          const cancelError = new Error('Request was cancelled');
          cancelError.name = 'AbortError';
          reject(cancelError);
        }
      };

      if (signal.aborted) {
        return onAbort();
      }

      signal.addEventListener('abort', onAbort, { once: true });

      const requestCleanup = () => {
        cleanup();
        signal.removeEventListener('abort', onAbort);
      };

      this.pendingRequests.set(request.id, {
        resolve: resolve as (val: JSONRPCResponse<any>) => void,
        reject,
        cleanup: requestCleanup,
      });

      const line = JSON.stringify(request) + '\n';
      this.outputStream!.write(line, (err) => {
        if (err) {
          this.pendingRequests.delete(request.id);
          requestCleanup();
          reject(err);
        }
      });
    });
  }

  async sendNotification(notification: JSONRPCNotification): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport is disconnected');
    }
    const line = JSON.stringify(notification) + '\n';
    this.outputStream!.write(line);
  }
}

/**
 * MCPTransportManager (ANI-970, ANI-972)
 * Manages active transports across streamable-http, sse, and stdio protocols.
 */
export class MCPTransportManager {
  private transports: Map<string, IMCPTransport> = new Map(); // key: serverId
  private customFactories: Map<MCPTransportType, (serverDef: MCPServerDefinition) => IMCPTransport> = new Map();

  registerCustomFactory(
    type: MCPTransportType,
    factory: (serverDef: MCPServerDefinition) => IMCPTransport
  ): void {
    this.customFactories.set(type, factory);
  }

  createStreamableHTTPTransport(endpoint: string, options?: { fetchFn?: typeof fetch }): StreamableHTTPTransport {
    return new StreamableHTTPTransport(endpoint, options);
  }

  createSSETransport(endpoint: string, options?: { fetchFn?: typeof fetch }): SSETransport {
    return new SSETransport(endpoint, options);
  }

  createStdioTransport(
    endpoint: string,
    options?: { inputStream?: Readable; outputStream?: Writable; command?: string; args?: string[] }
  ): StdioTransport {
    return new StdioTransport(endpoint, options);
  }

  async getOrCreateTransport(server: MCPServerDefinition): Promise<IMCPTransport> {
    const existing = this.transports.get(server.serverId);
    if (existing && existing.isConnected()) {
      return existing;
    }

    let transport: IMCPTransport;

    if (this.customFactories.has(server.transport)) {
      const factory = this.customFactories.get(server.transport)!;
      transport = factory(server);
    } else {
      switch (server.transport) {
        case 'streamable-http':
          transport = this.createStreamableHTTPTransport(server.endpoint);
          break;
        case 'sse':
          transport = this.createSSETransport(server.endpoint);
          break;
        case 'stdio':
          transport = this.createStdioTransport(server.endpoint);
          break;
        default:
          throw new Error(`Unsupported transport: ${server.transport}`);
      }
    }

    await transport.connect();
    this.transports.set(server.serverId, transport);
    return transport;
  }

  async closeTransport(serverId: string): Promise<void> {
    const transport = this.transports.get(serverId);
    if (transport) {
      await transport.disconnect();
      this.transports.delete(serverId);
    }
  }

  async closeAll(): Promise<void> {
    const closePromises = Array.from(this.transports.values()).map((t) => t.disconnect());
    await Promise.all(closePromises);
    this.transports.clear();
  }
}

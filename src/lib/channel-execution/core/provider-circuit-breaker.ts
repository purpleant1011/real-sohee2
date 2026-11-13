/**
 * Provider Circuit Breaker & Emergency Kill Switch System (ANI-778)
 * 
 * Invariants:
 * 1. 3 consecutive failures (429/5xx) trips circuit to OPEN.
 * 2. After cool-down, circuit enters HALF_OPEN for probe request.
 * 3. Successful probe transitions back to CLOSED. Failed probe trips back to OPEN.
 * 4. Kill Switch takes precedence over all states (Global or Channel/Provider scoped).
 * 5. Requests rejected by OPEN circuit can be buffered into Fallback Queue.
 */

import {
  CircuitBreakerMetrics,
  CircuitBreakerState,
  ExecutionChannel,
  KillSwitchStatus
} from './channel-execution-types';

export interface CircuitBreakerConfig {
  failureThreshold: number; // default: 3
  coolDownMs: number; // default: 30_000 (30s)
}

export interface QueuedFallbackItem {
  id: string;
  workspaceId: string;
  channel: ExecutionChannel;
  provider: string;
  action: string;
  payload: unknown;
  enqueuedAt: string;
}

export class ProviderCircuitBreakerRegistry {
  private metricsMap = new Map<string, CircuitBreakerMetrics>();
  private killSwitchStatus: KillSwitchStatus = {
    isGlobalKilled: false,
    killedChannels: [],
    killedProviders: [],
    lastUpdated: new Date().toISOString(),
  };
  private fallbackQueue: QueuedFallbackItem[] = [];

  constructor(
    private readonly config: CircuitBreakerConfig = {
      failureThreshold: 3,
      coolDownMs: 30_000,
    }
  ) {}

  private getKey(channel: ExecutionChannel, provider: string): string {
    return `${channel}:${provider}`;
  }

  public getMetrics(channel: ExecutionChannel, provider: string): CircuitBreakerMetrics {
    const key = this.getKey(channel, provider);
    let metrics = this.metricsMap.get(key);
    if (!metrics) {
      metrics = {
        consecutiveFailures: 0,
        lastStateChangeTimestamp: new Date().toISOString(),
        state: 'CLOSED',
      };
      this.metricsMap.set(key, metrics);
    }
    return metrics;
  }

  public getKillSwitchStatus(): KillSwitchStatus {
    return { ...this.killSwitchStatus };
  }

  // --- Kill Switch Controls ---
  public triggerGlobalKillSwitch(reason: string): void {
    this.killSwitchStatus.isGlobalKilled = true;
    this.killSwitchStatus.reason = reason;
    this.killSwitchStatus.lastUpdated = new Date().toISOString();
  }

  public releaseGlobalKillSwitch(): void {
    this.killSwitchStatus.isGlobalKilled = false;
    this.killSwitchStatus.lastUpdated = new Date().toISOString();
  }

  public triggerChannelKillSwitch(channel: ExecutionChannel, reason: string): void {
    if (!this.killSwitchStatus.killedChannels.includes(channel)) {
      this.killSwitchStatus.killedChannels.push(channel);
    }
    this.killSwitchStatus.reason = reason;
    this.killSwitchStatus.lastUpdated = new Date().toISOString();
  }

  public releaseChannelKillSwitch(channel: ExecutionChannel): void {
    this.killSwitchStatus.killedChannels = this.killSwitchStatus.killedChannels.filter(c => c !== channel);
    this.killSwitchStatus.lastUpdated = new Date().toISOString();
  }

  public triggerProviderKillSwitch(provider: string, reason: string): void {
    if (!this.killSwitchStatus.killedProviders.includes(provider)) {
      this.killSwitchStatus.killedProviders.push(provider);
    }
    this.killSwitchStatus.reason = reason;
    this.killSwitchStatus.lastUpdated = new Date().toISOString();
  }

  public releaseProviderKillSwitch(provider: string): void {
    this.killSwitchStatus.killedProviders = this.killSwitchStatus.killedProviders.filter(p => p !== provider);
    this.killSwitchStatus.lastUpdated = new Date().toISOString();
  }

  // --- Preflight Check ---
  public checkExecutionAllowed(channel: ExecutionChannel, provider: string): {
    allowed: boolean;
    reason?: string;
    state: CircuitBreakerState;
  } {
    // 1. Kill Switch Check
    if (this.killSwitchStatus.isGlobalKilled) {
      return {
        allowed: false,
        reason: `Global Kill Switch active: ${this.killSwitchStatus.reason ?? 'Emergency freeze'}`,
        state: 'OPEN',
      };
    }
    if (this.killSwitchStatus.killedChannels.includes(channel)) {
      return {
        allowed: false,
        reason: `Channel Kill Switch active for ${channel}: ${this.killSwitchStatus.reason ?? 'Channel frozen'}`,
        state: 'OPEN',
      };
    }
    if (this.killSwitchStatus.killedProviders.includes(provider)) {
      return {
        allowed: false,
        reason: `Provider Kill Switch active for ${provider}: ${this.killSwitchStatus.reason ?? 'Provider frozen'}`,
        state: 'OPEN',
      };
    }

    // 2. Circuit Breaker State Check
    const metrics = this.getMetrics(channel, provider);
    if (metrics.state === 'OPEN') {
      const elapsed = Date.now() - new Date(metrics.lastStateChangeTimestamp).getTime();
      if (elapsed >= this.config.coolDownMs) {
        // Transition to HALF_OPEN to probe recovery
        metrics.state = 'HALF_OPEN';
        metrics.lastStateChangeTimestamp = new Date().toISOString();
        return { allowed: true, state: 'HALF_OPEN' };
      }
      return {
        allowed: false,
        reason: `Circuit OPEN due to: ${metrics.circuitOpenReason ?? 'Consecutive failures'} (cooldown remaining: ${Math.max(0, this.config.coolDownMs - elapsed)}ms)`,
        state: 'OPEN',
      };
    }

    return { allowed: true, state: metrics.state };
  }

  // --- Post-execution Feedback ---
  public recordSuccess(channel: ExecutionChannel, provider: string): void {
    const metrics = this.getMetrics(channel, provider);
    metrics.consecutiveFailures = 0;
    if (metrics.state !== 'CLOSED') {
      metrics.state = 'CLOSED';
      metrics.lastStateChangeTimestamp = new Date().toISOString();
      metrics.circuitOpenReason = undefined;
    }
  }

  public recordFailure(channel: ExecutionChannel, provider: string, errorReason: string): CircuitBreakerState {
    const metrics = this.getMetrics(channel, provider);
    metrics.consecutiveFailures += 1;
    metrics.lastFailureTimestamp = new Date().toISOString();

    if (metrics.state === 'HALF_OPEN' || metrics.consecutiveFailures >= this.config.failureThreshold) {
      metrics.state = 'OPEN';
      metrics.lastStateChangeTimestamp = new Date().toISOString();
      metrics.circuitOpenReason = errorReason;
    }

    return metrics.state;
  }

  // --- Fallback Queue ---
  public enqueueFallback(item: Omit<QueuedFallbackItem, 'enqueuedAt'>): void {
    this.fallbackQueue.push({
      ...item,
      enqueuedAt: new Date().toISOString(),
    });
  }

  public getFallbackQueue(): readonly QueuedFallbackItem[] {
    return [...this.fallbackQueue];
  }

  public clearFallbackQueue(): void {
    this.fallbackQueue = [];
  }
}

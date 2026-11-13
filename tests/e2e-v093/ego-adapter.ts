/**
 * Official ego-browser SDK Adapter Skeleton (ANI-1635)
 *
 * Implements the contract according to official ego-browser guide v2.1.0:
 * - Single TaskSpace lifecycle: 1 full customer journey (goal) uses exactly 1 TaskSpace
 *   (e.g. const task = await taskSpace("v093 full customer journey e2e")), reusing task.spaceId across rounds.
 * - Tab/Page management: Distinguish default/initial page (task.page("p1")) from new tabs (task.newPage()).
 * - Lifecycle completion: Call await task.finish({ keep: [] }) ONLY once upon full journey success.
 * - Human Takeover: If user takes control or space is inactive/unassigned, stop immediately.
 *   Call await task.handOff(), do not retry or route around user control.
 *
 * Invariant:
 * Factory thunk pattern is strictly enforced. Creating or inspecting this adapter
 * does NOT instantiate or launch browser processes or SDK instances.
 * In this skeleton phase, all actual browser operations are deferred and NOT_VERIFIED.
 */

import type { StepId } from "./manifest";

export interface EgoAdapterBinding {
  isBound: boolean;
  driverFactory?: () => unknown;
  appSelectors?: Record<string, string>;
  fixtureLoader?: (stepId: StepId) => Promise<unknown>;
  canonicalReader?: (stepId: StepId) => Promise<unknown>;
}

export interface EgoExecutionResult {
  stepId: StepId;
  status: "NOT_VERIFIED" | "PASS" | "FAIL";
  actionsExecuted: number;
  reason: string;
}

export class EgoAdapterSkeleton {
  private binding: EgoAdapterBinding;

  constructor(binding?: EgoAdapterBinding) {
    this.binding = binding ?? { isBound: false };
  }

  public isReady(): boolean {
    return (
      this.binding.isBound &&
      typeof this.binding.driverFactory === "function" &&
      !!this.binding.appSelectors &&
      !!this.binding.fixtureLoader &&
      !!this.binding.canonicalReader
    );
  }

  /**
   * Executes a step via official Ego browser workflow.
   * If unbound (as in current unintegrated test runner), immediately returns NOT_VERIFIED
   * without calling driver factory or launching browser processes.
   */
  public async executeStep(stepId: StepId): Promise<EgoExecutionResult> {
    if (!this.isReady()) {
      return {
        stepId,
        status: "NOT_VERIFIED",
        actionsExecuted: 0,
        reason: "ADAPTER_UNBOUND: Missing app selectors, fixture loader, or canonical reader",
      };
    }

    return {
      stepId,
      status: "NOT_VERIFIED",
      actionsExecuted: 0,
      reason: "LIVE_EXECUTION_DEFERRED_TO_INTEGRATION_PHASE",
    };
  }
}

export function createEgoAdapterSkeleton(binding?: EgoAdapterBinding): EgoAdapterSkeleton {
  return new EgoAdapterSkeleton(binding);
}

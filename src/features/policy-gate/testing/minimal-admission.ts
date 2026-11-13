/**
 * Minimal Admission Contract
 * ANI-1616 / ANI-1617 / ANI-1620
 * Strict TEST admission gate & capability evaluator seam.
 */

export type Dataset = 'ACTUAL' | 'SHOWCASE_DEMO' | 'TEST';
export type Provider = 'portone' | 'kakao';
export type Action = 'payment' | 'refund' | 'message';

export type Scope = Readonly<{
  workspaceId: string;
  provider: Provider;
  action: Action;
  operationKey: string;
}>;

export type Controls = Readonly<{
  mode: 'OFF' | 'TEST_FAKE_ONLY';
  datasetMode: Dataset;
  allowedWorkspaceIds: readonly string[];
  killSwitch: boolean;
}>;

export type CapabilityQuery = Readonly<{
  workspaceId: string;
  provider: Provider;
  action: Action;
  now: Date;
}>;

export type CapabilityDecision = Readonly<{
  ready: boolean;
  reason?: string;
  manualAlternative?: string;
}>;

export type Evaluator = (query: CapabilityQuery) => CapabilityDecision | Promise<CapabilityDecision>;

export type Context = Readonly<{
  controls?: Controls;
  now: Date;
  evaluator?: Evaluator;
}>;

export type TestRequest = Readonly<{
  scope: Scope;
  payload: Uint8Array;
}>;

export type AdmissionAdmitted = Readonly<{
  kind: 'ADMITTED';
  datasetMode: 'TEST';
  actualVerified: false;
  scope: Scope;
}>;

export type AdmissionDenied = Readonly<{
  kind: 'DENIED';
  requestedDataset: Dataset | undefined;
  reason: string;
  manualAlternative: string | null;
  actualVerified: false;
  simulation: null;
}>;

export type AdmissionDecision = AdmissionAdmitted | AdmissionDenied;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(id: unknown): id is string {
  return typeof id === 'string' && UUID_REGEX.test(id.trim());
}

function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !isNaN(d.getTime());
}

export async function checkMinimalAdmission(
  context: Context,
  scope: Scope
): Promise<AdmissionDecision> {
  const requestedDataset = context?.controls?.datasetMode;

  const deny = (reason: string, manualAlternative: string | null = null): AdmissionDenied => ({
    kind: 'DENIED',
    requestedDataset,
    reason,
    manualAlternative,
    actualVerified: false,
    simulation: null,
  });

  if (process.env.NODE_ENV === 'production') {
    return deny('PRODUCTION_FORBIDDEN');
  }

  const controls = context?.controls;
  if (!controls) {
    return deny('CONTROLS_MISSING');
  }

  if (controls.mode !== 'TEST_FAKE_ONLY') {
    return deny('MODE_NOT_TEST_FAKE_ONLY');
  }

  if (controls.datasetMode !== 'TEST') {
    return deny('DATASET_MODE_NOT_TEST');
  }

  if (controls.killSwitch !== false) {
    return deny('KILL_SWITCH_ACTIVE_OR_INVALID');
  }

  if (!Array.isArray(controls.allowedWorkspaceIds) || controls.allowedWorkspaceIds.length === 0) {
    return deny('ALLOWED_WORKSPACES_EMPTY_OR_INVALID');
  }

  for (const id of controls.allowedWorkspaceIds) {
    if (typeof id !== 'string' || id.trim() === '*' || !isValidUuid(id)) {
      return deny('ALLOWED_WORKSPACES_INVALID_ENTRY');
    }
  }

  if (!scope || !isValidUuid(scope.workspaceId)) {
    return deny('SCOPE_WORKSPACE_INVALID');
  }

  const isAllowed = controls.allowedWorkspaceIds.some((id) => id === scope.workspaceId);
  if (!isAllowed) {
    return deny('WORKSPACE_NOT_ALLOWED');
  }

  if (!scope.operationKey || typeof scope.operationKey !== 'string' || scope.operationKey.trim().length === 0) {
    return deny('SCOPE_OPERATION_KEY_INVALID');
  }

  // Provider / Action pair validation
  const validPair =
    ((scope.action === 'payment' || scope.action === 'refund') && scope.provider === 'portone') ||
    (scope.action === 'message' && scope.provider === 'kakao');

  if (!validPair) {
    return deny('PROVIDER_ACTION_MISMATCH');
  }

  if (!isValidDate(context.now)) {
    return deny('INVALID_NOW_DATE');
  }

  if (typeof context.evaluator !== 'function') {
    return deny('EVALUATOR_REQUIRED');
  }

  let decision: CapabilityDecision;
  try {
    decision = await context.evaluator({
      workspaceId: scope.workspaceId,
      provider: scope.provider,
      action: scope.action,
      now: context.now,
    });
  } catch {
    return deny('EVALUATOR_ERROR');
  }

  if (!decision || decision.ready !== true) {
    return deny(
      typeof decision?.reason === 'string' ? decision.reason : 'CAPABILITY_NOT_READY',
      typeof decision?.manualAlternative === 'string' ? decision.manualAlternative : null
    );
  }

  return {
    kind: 'ADMITTED',
    datasetMode: 'TEST',
    actualVerified: false,
    scope: {
      workspaceId: scope.workspaceId,
      provider: scope.provider,
      action: scope.action,
      operationKey: scope.operationKey,
    },
  };
}

export function createMinimalAdmissionEvaluator(): Evaluator {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('PRODUCTION_FORBIDDEN: minimal admission evaluator cannot be created in production');
  }
  return () => ({ ready: true });
}

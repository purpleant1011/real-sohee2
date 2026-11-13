/**
 * Browser Adapter Supervised Capability (ANI-817)
 * 
 * Core Invariants:
 * 1. DOM Success != Business Success: Clicking a button or executing JavaScript in a browser is NOT business proof.
 * 2. Supervised Evidence: Requires visual screenshot, current final URL, and remote object readback.
 * 3. Execution Safety: Tracks session isolation, selector drift, CAPTCHA challenges, and consent boundaries.
 * 4. Without authoritative remote object readback, external status CANNOT be VERIFIED.
 */

export interface BrowserExecutionTelemetry {
  sessionIsolated: boolean;
  selectorDriftDetected: boolean;
  captchaDetected: boolean;
  consentBoundaryEncountered: boolean;
  domClickSucceeded: boolean;
  finalPageUrl: string;
  screenshotArtifactUrl?: string;
  remoteObjectId?: string;
}

export interface BrowserSupervisionEvaluation {
  isBusinessVerified: boolean;
  status: 'VERIFIED' | 'RESULT_UNKNOWN' | 'BLOCKED_CAPTCHA' | 'BLOCKED_CONSENT' | 'DOM_SUCCESS_ONLY_UNVERIFIED';
  reason: string;
  telemetry: BrowserExecutionTelemetry;
  evidenceId?: string;
}

export function evaluateBrowserSupervisedExecution(
  telemetry: BrowserExecutionTelemetry,
  actionRunId: string
): BrowserSupervisionEvaluation {
  // 1. Safety Boundary: CAPTCHA
  if (telemetry.captchaDetected) {
    return {
      isBusinessVerified: false,
      status: 'BLOCKED_CAPTCHA',
      reason: 'Automated browser encountered an anti-bot CAPTCHA challenge. Human supervision or intervention required.',
      telemetry,
    };
  }

  // 2. Safety Boundary: User Consent / Policy Barrier
  if (telemetry.consentBoundaryEncountered) {
    return {
      isBusinessVerified: false,
      status: 'BLOCKED_CONSENT',
      reason: 'Browser encountered a third-party consent boundary requiring owner approval.',
      telemetry,
    };
  }

  // 3. Security Boundary: Session Isolation
  if (!telemetry.sessionIsolated) {
    return {
      isBusinessVerified: false,
      status: 'RESULT_UNKNOWN',
      reason: 'Browser runtime failed to verify isolated incognito profile / cookie boundary.',
      telemetry,
    };
  }

  // 4. Selector Drift Warning
  if (telemetry.selectorDriftDetected) {
    return {
      isBusinessVerified: false,
      status: 'RESULT_UNKNOWN',
      reason: 'UI Selector drift detected on target website. DOM interaction outcome is indeterminate.',
      telemetry,
    };
  }

  // 5. DOM Success without Readback or Screenshot is UNVERIFIED
  if (telemetry.domClickSucceeded && (!telemetry.remoteObjectId || !telemetry.screenshotArtifactUrl)) {
    return {
      isBusinessVerified: false,
      status: 'DOM_SUCCESS_ONLY_UNVERIFIED',
      reason: 'DOM interaction reported success, but visual screenshot or authoritative remote object ID is missing.',
      telemetry,
    };
  }

  // 6. Complete Business Verification
  if (telemetry.domClickSucceeded && telemetry.remoteObjectId && telemetry.screenshotArtifactUrl) {
    const evidenceId = `ev_browser_${actionRunId}_${Date.now()}`;
    return {
      isBusinessVerified: true,
      status: 'VERIFIED',
      reason: 'Browser execution satisfied all supervised criteria: session isolation, visual screenshot, and authoritative object ID.',
      telemetry,
      evidenceId,
    };
  }

  return {
    isBusinessVerified: false,
    status: 'RESULT_UNKNOWN',
    reason: 'Browser interaction finished without confirming business outcome.',
    telemetry,
  };
}

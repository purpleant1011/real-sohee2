import { describe, it, expect } from 'vitest';
import { evaluateBrowserSupervisedExecution } from '../browser-adapter-supervisor';

describe('ANI-817: Browser Adapter Supervised Capability', () => {
  it('certifies VERIFIED when session is isolated, DOM succeeded, screenshot taken, and remote object readback exists', () => {
    const evaluation = evaluateBrowserSupervisedExecution(
      {
        sessionIsolated: true,
        selectorDriftDetected: false,
        captchaDetected: false,
        consentBoundaryEncountered: false,
        domClickSucceeded: true,
        finalPageUrl: 'https://smartplace.naver.com/manage/posts/12345',
        screenshotArtifactUrl: 'https://storage.sohee.ai/artifacts/shots/shot-123.png',
        remoteObjectId: 'post-12345',
      },
      'run-browser-99'
    );

    expect(evaluation.isBusinessVerified).toBe(true);
    expect(evaluation.status).toBe('VERIFIED');
    expect(evaluation.evidenceId).toBeDefined();
    expect(evaluation.evidenceId).toContain('run-browser-99');
  });

  it('prohibits VERIFIED when only DOM succeeded but screenshot or remote object readback is missing', () => {
    const evaluation = evaluateBrowserSupervisedExecution(
      {
        sessionIsolated: true,
        selectorDriftDetected: false,
        captchaDetected: false,
        consentBoundaryEncountered: false,
        domClickSucceeded: true,
        finalPageUrl: 'https://smartplace.naver.com/manage/posts',
        // screenshot missing!
        remoteObjectId: undefined,
      },
      'run-dom-only'
    );

    expect(evaluation.isBusinessVerified).toBe(false);
    expect(evaluation.status).toBe('DOM_SUCCESS_ONLY_UNVERIFIED');
    expect(evaluation.reason).toContain('DOM interaction reported success, but visual screenshot or authoritative remote object ID is missing');
  });

  it('blocks execution when CAPTCHA is detected', () => {
    const evaluation = evaluateBrowserSupervisedExecution(
      {
        sessionIsolated: true,
        selectorDriftDetected: false,
        captchaDetected: true,
        consentBoundaryEncountered: false,
        domClickSucceeded: false,
        finalPageUrl: 'https://nid.naver.com/captcha',
      },
      'run-captcha'
    );

    expect(evaluation.isBusinessVerified).toBe(false);
    expect(evaluation.status).toBe('BLOCKED_CAPTCHA');
    expect(evaluation.reason).toContain('anti-bot CAPTCHA');
  });

  it('treats selector drift as indeterminate RESULT_UNKNOWN', () => {
    const evaluation = evaluateBrowserSupervisedExecution(
      {
        sessionIsolated: true,
        selectorDriftDetected: true,
        captchaDetected: false,
        consentBoundaryEncountered: false,
        domClickSucceeded: true,
        finalPageUrl: 'https://smartplace.naver.com/unknown',
        screenshotArtifactUrl: 'https://storage.sohee.ai/artifacts/shots/drift.png',
        remoteObjectId: 'unknown',
      },
      'run-drift'
    );

    expect(evaluation.isBusinessVerified).toBe(false);
    expect(evaluation.status).toBe('RESULT_UNKNOWN');
    expect(evaluation.reason).toContain('UI Selector drift detected');
  });
});

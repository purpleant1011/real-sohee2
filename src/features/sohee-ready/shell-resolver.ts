import type { SoheeReadinessSnapshot } from './types';

export type AppShellMode = 'EDUCATION_SHELL' | 'WORK_APP_SHELL';

/**
 * HF-07 / RED-03: Shell Resolution Gate
 * Pre-ready users MUST be isolated in EducationShell.
 * WorkAppShell (V088AppShell / Full Dock) is ONLY accessible when SOHEE_READY = TRUE.
 */
export function resolveAppShellMode(readiness: SoheeReadinessSnapshot): AppShellMode {
  if (!readiness || !readiness.ready) {
    return 'EDUCATION_SHELL';
  }
  return 'WORK_APP_SHELL';
}

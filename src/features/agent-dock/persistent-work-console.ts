/**
 * Persistent Sohee Work Console State (ANI-1238)
 * 
 * Manages the persistent right-side Agent Dock state across route changes (Home ↔ Content ↔ Customer ↔ Results).
 * Maps natural language owner commands ("지금 올려", "멈춰", "수정해") to canonical mission actions with Same-Truth guarantee.
 */

export interface ConsoleEntityContext {
  workspaceId: string;
  activeMissionId?: string | null;
  activeCustomerId?: string | null;
  canonicalStatus?: string;
  currentRoute: string;
  lastUpdated?: string;
}

export type ConsoleCanonicalAction =
  | 'APPROVE_AND_EXECUTE'
  | 'PAUSE_MISSION'
  | 'REQUEST_REVISION'
  | 'BOOK_SLOT'
  | 'UNKNOWN';

export interface ConsoleActionInterpretation {
  canonicalAction: ConsoleCanonicalAction;
  targetEntityId: string;
  rawInput: string;
}

export class PersistentWorkConsoleState {
  private context: ConsoleEntityContext | null = null;

  setContext(context: ConsoleEntityContext): void {
    this.context = {
      ...context,
      lastUpdated: new Date().toISOString(),
    };
  }

  getContext(): ConsoleEntityContext | null {
    return this.context;
  }

  /**
   * Updates current route while strictly preserving active mission and customer context.
   */
  navigateRoute(newRoute: string): void {
    if (!this.context) {
      return;
    }
    this.context = {
      ...this.context,
      currentRoute: newRoute,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Interprets natural language owner intent into a deterministic canonical action on the active entity.
   */
  interpretNaturalCommand(naturalCommand: string): ConsoleActionInterpretation {
    const trimmed = naturalCommand.trim();
    const targetEntityId = this.context?.activeMissionId || this.context?.activeCustomerId || '';

    let canonicalAction: ConsoleCanonicalAction = 'UNKNOWN';

    if (trimmed.includes('올려') || trimmed.includes('발행') || trimmed.includes('게시') || trimmed.includes('승인')) {
      canonicalAction = 'APPROVE_AND_EXECUTE';
    } else if (trimmed.includes('멈춰') || trimmed.includes('중단') || trimmed.includes('정지') || trimmed.includes('취소')) {
      canonicalAction = 'PAUSE_MISSION';
    } else if (trimmed.includes('수정') || trimmed.includes('바꿔') || trimmed.includes('다시 작성')) {
      canonicalAction = 'REQUEST_REVISION';
    } else if (trimmed.includes('예약 잡아') || trimmed.includes('예약해') || trimmed.includes('슬롯 등록')) {
      canonicalAction = 'BOOK_SLOT';
    }

    return {
      canonicalAction,
      targetEntityId,
      rawInput: naturalCommand,
    };
  }

  /**
   * Serializes console state for session storage or page reload recovery (F5 persistence).
   */
  serialize(): string {
    return JSON.stringify(this.context || {});
  }

  /**
   * Restores console state from serialized string.
   */
  restore(serialized: string): void {
    try {
      this.context = JSON.parse(serialized);
    } catch {
      this.context = null;
    }
  }
}

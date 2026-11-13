// A demo query flag or a real tenant ID is never authority to use sample data.
export function isMarketingFixtureWorkspace(workspaceId: string): boolean {
  return process.env.NODE_ENV !== 'production' &&
    (workspaceId === 'fixture:TEST:marketing' || workspaceId === 'fixture:SHOWCASE:marketing');
}

export class CapacityNotObservedError extends Error {
  readonly code = 'NOT_OBSERVED';

  constructor() {
    super('[NOT_OBSERVED] 예약 원장 공급자가 연결되지 않아 가용시간을 확인할 수 없습니다.');
    this.name = 'CapacityNotObservedError';
  }
}

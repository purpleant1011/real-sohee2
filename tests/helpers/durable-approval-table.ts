// 승인 서비스 테스트용 영속 원장. 조회 조건과 버전 CAS를 실행 시점에 평가한다.
export function createDurableApprovalTable() {
  const rows = new Map<string, Record<string, any>>();
  function table() {
    const filters: Array<[string, unknown]> = [];
    let updates: Record<string, any> | undefined;
    let inserted: Record<string, any> | undefined;
    const execute = () => {
      if (inserted) {
        const existing = [...rows.values()].find(row => row.workspace_id === inserted!.workspace_id && row.proposal_id === inserted!.proposal_id);
        const row = { ...inserted, id: existing?.id ?? crypto.randomUUID(), created_at: existing?.created_at ?? new Date().toISOString() };
        rows.set(row.id, row);
        return { data: { ...row }, error: null };
      }
      const row = [...rows.values()].find(item => filters.every(([key, value]) => item[key] === value));
      if (!row) return { data: null, error: null };
      if (updates) Object.assign(row, updates);
      return { data: { ...row }, error: null };
    };
    const query = {
      upsert(row: Record<string, any>) { inserted = row; return query; },
      select() { return query; },
      order() { return Promise.resolve({ data: [...rows.values()].filter(item => filters.every(([key, value]) => item[key] === value)).map(row => ({ ...row })), error: null }); },
      update(values: Record<string, any>) { updates = values; return query; },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      single: async () => execute(),
      maybeSingle: async () => execute(),
      then(resolve: any, reject: any) { return Promise.resolve(execute()).then(resolve, reject); },
    };
    return query;
  }
  return { rows, table };
}

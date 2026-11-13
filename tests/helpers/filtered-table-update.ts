export function filteredTableUpdate(rows: Record<string, any>[], patch: Record<string, unknown>) {
  const filters: Array<[string, unknown]> = []
  const execute = () => {
    const matching = rows.filter(row => filters.every(([key, value]) => row[key] === value))
    matching.forEach(row => Object.assign(row, patch))
    return { data: matching.map(row => ({ ...row })), error: null }
  }
  const query: any = {
    eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
    select: () => query,
    maybeSingle: async () => { const result = execute(); return { ...result, data: result.data[0] ?? null } },
    then: (resolve: any, reject: any) => Promise.resolve(execute()).then(resolve, reject),
  }
  return query
}

export type OperatorFetcher = (input: any, init?: any) => Promise<Response>

const ALLOWED_RESOURCES = new Set([
  'workspaces',
  'channels',
  'publishing',
  'billing',
  'incidents',
  'audit',
  'onboarding',
  'agents',
  'governance',
  'control-tower',
])

export function createOperatorDataProvider(customFetch?: OperatorFetcher) {
  const fetcher = customFetch || fetch
  return {
    getList: async ({ resource, pagination, filters, sorters, meta }: { resource: string; pagination?: any; filters?: any[]; sorters?: any[]; meta?: any }) => {
      if (!ALLOWED_RESOURCES.has(resource)) {
        const error = new Error('지원하지 않는 관리자 자료입니다.') as any
        error.statusCode = 404
        throw error
      }

      const params = new URLSearchParams()
      if (pagination?.currentPage) {
        params.set('page', String(pagination.currentPage))
      }
      if (pagination?.pageSize) {
        params.set('pageSize', String(pagination.pageSize))
      }
      if (filters && Array.isArray(filters)) {
        for (const f of filters) {
          if (f.field === 'query' && f.value) {
            params.set('query', String(f.value))
          } else if (f.field && f.value) {
            params.set(f.field, String(f.value))
          }
        }
      }
      if (sorters && Array.isArray(sorters) && sorters.length > 0) {
        params.set('sort', String(sorters[0].field))
        params.set('order', String(sorters[0].order))
      }

      const queryString = params.toString()
      const url = `/api/admin/refine/${resource}${queryString ? `?${queryString}` : ''}`

      const res = await fetcher(url, {
        method: 'GET',
        credentials: 'same-origin',
      })

      if (!res.ok) {
        const error = new Error('관리자 자료를 안전하게 불러오지 못했습니다.') as any
        error.statusCode = res.status
        throw error
      }

      const json = await res.json()
      const data = json?.data?.items || json?.data || []
      const total = typeof json?.total === 'number' ? json.total : (typeof json?.data?.total === 'number' ? json.data.total : data.length)

      return { data, total }
    },
    getOne: async () => ({ data: {} }),
    create: async () => ({ data: {} }),
    update: async () => ({ data: {} }),
    deleteOne: async () => ({ data: {} }),
    getApiUrl: () => '/api/admin',
  }
}

export function getOperatorCompatibilityRedirect(source: string): string {
  const [path, query = ''] = source.split('?', 2)
  const adminPath = path === '/operator' ? '/admin' : path.replace(/^\/operator(?=\/|$)/u, '/admin')
  return query ? `${adminPath}?${query}` : adminPath
}

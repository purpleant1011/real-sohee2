import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/app/', '/admin/', '/operator/', '/api/', '/auth/', '/e2e-fixture/', '/v075-qa/'],
    },
    sitemap: 'https://example.com/sitemap.xml',
  }
}

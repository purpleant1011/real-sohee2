import type { MetadataRoute } from 'next'

const publicPaths = [
  '/',
  '/product',
  '/channels',
  '/pricing',
  '/diagnosis',
  '/signup',
  '/industries/beauty',
  '/industries/food',
  '/industries/education',
  '/industries/local-service',
  '/terms',
  '/privacy',
  '/data-deletion',
  '/refund',
  '/payment-info',
  '/business-info',
] as const

export default function sitemap(): MetadataRoute.Sitemap {
  return publicPaths.map((path) => ({
    url: `https://example.com${path}`,
    lastModified: new Date('2026-08-24T00:00:00.000Z'),
    changeFrequency: path === '/' ? 'weekly' : 'monthly',
    priority: path === '/' ? 1 : path === '/diagnosis' || path === '/signup' ? 0.9 : 0.7,
  }))
}

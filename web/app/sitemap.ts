import type { MetadataRoute } from 'next'
import { SUBJECT_PAGES } from '@/lib/subjectPages'
import { COMPARE_PAGES } from '@/lib/comparePages'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://www.demist.app'
  const now = new Date()
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    // One entry per subject page. Generated from the same list the routes
    // are, so adding a subject cannot leave the sitemap behind.
    ...SUBJECT_PAGES.map(p => ({
      url: `${base}/for/${p.slug}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
    ...COMPARE_PAGES.map(p => ({
      url: `${base}/compare/${p.slug}`,
      lastModified: new Date(p.checkedOn),
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
    { url: `${base}/lecture-recordings`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ]
}

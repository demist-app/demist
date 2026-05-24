import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import PublicProfileClient from './profile-client'

interface Props {
  params: Promise<{ userId: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { userId } = await params
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  const { data } = await supabase.rpc('get_public_profile_stats', { target_user_id: userId })
  if (!data?.length) {
    return { title: 'Profile not found · Demist' }
  }

  const profile = data[0]
  const name = (profile.display_name as string | null) || 'A Demist user'
  const ogUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/og/${userId}`

  return {
    title: `${name} on Demist`,
    description: `${name} has learned ${profile.total_terms} terms with Demist.`,
    openGraph: {
      title: `${name} on Demist`,
      description: `${profile.terms_this_week} terms learned this week · ${profile.total_terms} total`,
      images: [{ url: ogUrl, width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image' },
  }
}

export default function PublicProfilePage() {
  return <PublicProfileClient />
}

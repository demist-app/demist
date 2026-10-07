import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
// Self-hosted, not next/font/google: on 2026-10-02 Vercel's build failed
// because Turbopack could not parse the font URLs Google returned for Plus
// Jakarta Sans ("next/font/google queries have exactly one entry"), with no
// code change to the font. Bundling the files removes Google from the build.
import "@fontsource-variable/plus-jakarta-sans";
// Reading-comfort fonts (lib/comfortPrefs.ts). @font-face only downloads the
// files when a student actually picks one, so these cost nothing otherwise.
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource-variable/lexend";
import { PHProvider } from "./providers";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://www.demist.app'),
  title: {
    default: 'Demist: live lecture transcription, explanations & flashcards',
    template: '%s | Demist',
  },
  description: 'Demist transcribes your lectures, reads them back, and explains and translates unfamiliar terms in real time, for students who find lectures harder to follow. Builds a glossary and flashcards automatically.',
  keywords: ['lecture tool', 'study app', 'university students', 'real-time definitions', 'glossary builder', 'flashcards', 'spaced repetition', 'student productivity'],
  authors: [{ name: 'Demist' }],
  creator: 'Demist',
  publisher: 'Graceful Minds',
  alternates: { canonical: '/' },
  // Bing Webmaster Tools ownership. ChatGPT's web search leans on Bing's
  // index, and the site had never been verified there. Set
  // BING_SITE_VERIFICATION in Vercel to the msvalidate.01 value Bing gives.
  ...(process.env.BING_SITE_VERIFICATION
    ? { verification: { other: { 'msvalidate.01': process.env.BING_SITE_VERIFICATION } } }
    : {}),
  openGraph: {
    siteName: 'Demist',
    type: 'website',
    locale: 'en_GB',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@demistapp',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>){
  return (
    <html
      lang="en"
      className={`${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Preconnect to Supabase and PostHog to cut DNS + TLS time on first API call */}
        <link rel="preconnect" href={`https://${process.env.NEXT_PUBLIC_SUPABASE_URL?.split('//')[1]}`} />
        <link rel="dns-prefetch" href={`https://${process.env.NEXT_PUBLIC_SUPABASE_URL?.split('//')[1]}`} />
        <link rel="preconnect" href="https://eu.i.posthog.com" />
        <link rel="dns-prefetch" href="https://eu.i.posthog.com" />

        {/* iOS PWA: improves the home-screen experience for iPhone users */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Demist" />
        {/* Apple only renders PNG apple-touch-icons reliably, not SVG */}
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        {/* PWA install (desktop Chrome/Edge, Android) */}
        <link rel="manifest" href="/manifest.webmanifest" />
        {/* Default light value for pre-hydration paint; kept in sync with the
            actual active theme (manual toggle, not OS preference) by
            ThemeColorSync in providers.tsx once the app mounts. */}
        <meta name="theme-color" content="#F3F0F8" />
      </head>
      <body className="min-h-full flex flex-col">
        <div id="init-loader" aria-hidden="true" />
        <PHProvider>{children}</PHProvider>
      </body>
    </html>
  );
}

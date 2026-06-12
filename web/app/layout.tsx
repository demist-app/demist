import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import { PHProvider } from "./providers";
import "./globals.css";

const jakartaSans = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://demist.app'),
  title: {
    default: 'Demist: Never Feel Lost in a Lecture Again',
    template: '%s | Demist',
  },
  description: 'Demist listens to your university lectures and picks out definitions for unfamiliar terms in real time. Build a personal glossary and review with spaced repetition flashcards.',
  keywords: ['lecture tool', 'study app', 'university students', 'real-time definitions', 'glossary builder', 'flashcards', 'spaced repetition', 'student productivity'],
  authors: [{ name: 'Demist' }],
  creator: 'Demist',
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
      className={`${jakartaSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Preconnect to Supabase and PostHog to cut DNS + TLS time on first API call */}
        <link rel="preconnect" href={`https://${process.env.NEXT_PUBLIC_SUPABASE_URL?.split('//')[1]}`} />
        <link rel="dns-prefetch" href={`https://${process.env.NEXT_PUBLIC_SUPABASE_URL?.split('//')[1]}`} />
        <link rel="preconnect" href="https://eu.i.posthog.com" />
        <link rel="dns-prefetch" href="https://eu.i.posthog.com" />

        {/* iOS PWA — improves the home-screen experience for iPhone users */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Demist" />
        <link rel="apple-touch-icon" href="/icon.svg" />
        <meta name="theme-color" content="#e8e4dc" />
      </head>
      <body className="min-h-full flex flex-col">
        <div id="init-loader" aria-hidden="true" />
        <PHProvider>{children}</PHProvider>
      </body>
    </html>
  );
}

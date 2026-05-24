import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PHProvider } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://demist.app'),
  title: {
    default: 'Demist — Never Feel Lost in a Lecture Again',
    template: '%s | Demist',
  },
  description: 'Demist listens to your university lectures and surfaces real-time definitions for unfamiliar terms. Build your personal glossary, review with flashcards, and never lose the thread.',
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
          <PHProvider>{children}</PHProvider>
        </body>
    </html>
  );
}

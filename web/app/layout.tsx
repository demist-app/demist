import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PHProvider } from "./providers";
import { createClient } from "@/lib/supabase-server";
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
  title: "Demist",
  description: "Never feel lost in a lecture again.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient()
  await supabase.auth.getUser()
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

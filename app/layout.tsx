import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { Navbar } from "@/components/layout/Navbar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "compass — sıfır onboarding süreli AI codebase rehberi",
  description:
    "Bir GitHub repo URL'si yapıştır, 30 saniye sonra AI seninle gezip kodu açıklayan etkileşimli bir tur başlatsın.",
  applicationName: "compass",
};

export const viewport: Viewport = {
  themeColor: "#0a0e14",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Navbar />
        <main className="flex flex-1 flex-col">{children}</main>
        {/* Both are no-ops in dev and when the Vercel deployment isn't
            actually serving the request — safe to mount unconditionally. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}

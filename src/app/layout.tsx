import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies, headers } from "next/headers";
import { Toaster } from "@/components/ui/sonner";
import { RouteProgress } from "@/components/route-progress";
import { I18nProvider } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/types";
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
  title: "SEAJelly -- Self Evolution Agent",
  description:
    "Let everyone have a cloud AI Agent in 5 minutes -- no server, no Docker, no SSH.",
  icons: {
    icon: { url: "/logo.svg", type: "image/svg+xml" },
  },
};

/** 服务端检测语言：优先读 Cookie，其次读 Accept-Language 请求头 */
function detectServerLocale(
  cookieValue: string | undefined,
  acceptLanguage: string | undefined
): Locale {
  if (cookieValue === "zh" || cookieValue === "en") return cookieValue;
  if (acceptLanguage && acceptLanguage.includes("zh")) return "zh";
  return "en";
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const headerStore = await headers();

  const localeCookie = cookieStore.get("seajelly-locale")?.value;
  const acceptLanguage = headerStore.get("accept-language") ?? undefined;
  const initialLocale = detectServerLocale(localeCookie, acceptLanguage);

  return (
    <html
      lang={initialLocale === "zh" ? "zh-CN" : "en"}
      suppressHydrationWarning
    >
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <I18nProvider initialLocale={initialLocale}>
          <RouteProgress />
          {children}
          <Toaster richColors />
        </I18nProvider>
      </body>
    </html>
  );
}

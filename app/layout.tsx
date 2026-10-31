import type { Metadata, Viewport } from "next";
import { Alegreya, Alegreya_Sans, Alegreya_Sans_SC, Caveat } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { PageErrors } from "../components/PageErrors";
import { MatLight } from "../components/MatLight";
import { HOME_TITLE, SITE_DESCRIPTION, SITE_NAME, indexable, publicOrigin } from "../lib/server/site";
import "./globals.css";

const display = Alegreya({ subsets: ["latin"], weight: ["500", "700", "800"], variable: "--font-display", display: "swap" });
const ui = Alegreya_Sans({ subsets: ["latin"], weight: ["400", "500", "700", "800"], variable: "--font-ui", display: "swap" });
// zone labels printed on the mat, and Claude's handwritten notes (not preloaded: they are small and below the fold)
const label = Alegreya_Sans_SC({ subsets: ["latin"], weight: ["700"], variable: "--font-label", display: "swap" });
const note = Caveat({ subsets: ["latin"], weight: ["600"], variable: "--font-note", display: "swap", preload: false });

// The defaults every page starts from; pages set their own title, description and canonical URL.
export async function generateMetadata(): Promise<Metadata> {
  const origin = await publicOrigin();
  const title = HOME_TITLE;
  const google = process.env.GOOGLE_SITE_VERIFICATION?.trim();
  const bing = process.env.BING_SITE_VERIFICATION?.trim();
  return {
    metadataBase: new URL(origin),
    title,
    description: SITE_DESCRIPTION,
    applicationName: SITE_NAME,
    keywords: ["Commander deck builder", "EDH deck builder", "AI deck builder", "MTG deck generator", "Commander bracket checker", "Magic: The Gathering", "booster box EV", "Claude"],
    authors: [{ name: "Murat Sahin", url: "https://github.com/M-Sahin" }],
    creator: "Murat Sahin",
    category: "games",
    robots: indexable() ? { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } : { index: false, follow: false },
    openGraph: { type: "website", siteName: SITE_NAME, locale: "en", title, description: SITE_DESCRIPTION, url: "/", images: [{ url: "/og.jpg", width: 1200, height: 630, alt: `${SITE_NAME}: five cards in, a hundred out` }] },
    twitter: { card: "summary_large_image", title, description: SITE_DESCRIPTION, images: ["/og.jpg"] },
    alternates: { types: { "text/plain": "/llms.txt" } },
    ...(google || bing ? { verification: { ...(google ? { google } : {}), ...(bing ? { other: { "msvalidate.01": bing } } : {}) } } : {}),
  };
}

// every page gets a per-request CSP nonce (proxy.ts), so pages render per request
export const dynamic = "force-dynamic";

export const viewport: Viewport = { themeColor: "#0b0e26", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${label.variable} ${note.variable}`}>
      <body>
        {children}
        <PageErrors />
        <MatLight />
        {/* Vercel Web Analytics only exists on Vercel; elsewhere (Docker, Node, CI) the script would 404 */}
        {process.env.VERCEL === "1" || process.env.VERCEL_ENV ? <Analytics /> : null}
      </body>
    </html>
  );
}

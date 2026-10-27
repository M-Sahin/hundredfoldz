// robots.txt: everything public may be crawled, by search engines and AI assistants alike; the
// personal pages and the API may not (except the link-preview images). Previews: nothing.
import type { MetadataRoute } from "next";
import { PRIVATE_PATHS, indexable, publicOrigin } from "../lib/server/site";

export const dynamic = "force-dynamic";

// Named so it's clear they're welcome: the crawlers behind ChatGPT, Claude, Perplexity, Gemini,
// Apple Intelligence and Common Crawl (which many models learn from), plus the big search engines
const AI_AND_SEARCH = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot",
  "Applebot-Extended",
  "CCBot",
  "Googlebot",
  "Bingbot",
  "DuckDuckBot",
];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await publicOrigin();
  if (!indexable()) return { rules: { userAgent: "*", disallow: "/" } };
  const rule = { allow: ["/", "/api/og"], disallow: PRIVATE_PATHS };
  return {
    rules: [
      { userAgent: AI_AND_SEARCH, ...rule },
      { userAgent: "*", ...rule },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}

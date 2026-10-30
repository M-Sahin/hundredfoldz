// sitemap.xml: the tools, the help pages, and a page per booster box (from the daily Box EV data).
import type { MetadataRoute } from "next";
import { evIndex } from "../lib/server/ev-data";
import { publicOrigin } from "../lib/server/site";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await publicOrigin();
  const index = await evIndex().catch(() => null);
  const updated = index?.generatedAt ? new Date(index.generatedAt) : new Date();
  return [
    { url: `${origin}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/workshop`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${origin}/bracket`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${origin}/ev`, lastModified: updated, changeFrequency: "daily", priority: 0.7 },
    ...(index?.products ?? []).map((p) => ({ url: `${origin}/ev/${p.id}`, lastModified: updated, changeFrequency: "daily" as const, priority: 0.5 })),
    { url: `${origin}/privacy`, changeFrequency: "yearly", priority: 0.2 },
  ];
}

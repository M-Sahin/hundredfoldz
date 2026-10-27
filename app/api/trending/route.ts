import { trendingCommanders } from "../../../lib/server/trending";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The same for everyone and it changes slowly: shared caches may keep it for six hours.
export async function GET() {
  try {
    const t = await trendingCommanders();
    return Response.json(t, { headers: { "cache-control": "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message, fresh: [], allTime: [] }, { status: 502 });
  }
}

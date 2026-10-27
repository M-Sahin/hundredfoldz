import { publicConfig } from "../../../lib/server/config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // per visitor (the currency comes from their country), so never cached
  return Response.json(publicConfig(request), { headers: { "cache-control": "private, no-store" } });
}

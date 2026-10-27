import { handleStatsEvent, handleStatsRead } from "../../../lib/server/stats-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleStatsEvent(request);
}

export async function GET(request: Request) {
  return handleStatsRead(request);
}

import { handleCoach, handleCoachStatus } from "../../../lib/server/coach-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The workshop's "Deal me 3": POST a deck and a slot, get three checked cards back as NDJSON. */
export async function POST(request: Request) {
  return handleCoach(request);
}

/** How many free deals this visitor has left today (when the site gives them out). */
export async function GET(request: Request) {
  return handleCoachStatus(request);
}

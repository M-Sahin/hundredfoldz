import { handleReport } from "../../../lib/server/community-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (r: Request) => handleReport(r);

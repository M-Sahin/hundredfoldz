import { handleView } from "../../../lib/server/community-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (r: Request) => handleView(r);

import { handleHandleCheck } from "../../../../lib/server/community-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (r: Request) => handleHandleCheck(r);

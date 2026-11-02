import { handleLike } from "../../../lib/server/community-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (r: Request) => handleLike(r);
export const POST = (r: Request) => handleLike(r);

import { handleProfile } from "../../../lib/server/community-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (r: Request) => handleProfile(r);
export const PUT = (r: Request) => handleProfile(r);
export const DELETE = (r: Request) => handleProfile(r);

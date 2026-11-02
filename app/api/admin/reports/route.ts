import { handleAdminReports } from "../../../../lib/server/community-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (r: Request) => handleAdminReports(r);
export const POST = (r: Request) => handleAdminReports(r);

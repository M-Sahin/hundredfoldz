import { handleCommanderSearch } from "../../../../lib/server/commander-search";

/** The workshop's pickers: GET /api/cards/commanders?q=mer (commanders) or ?with=<commander>&q= (partners) */
export async function GET(request: Request) {
  return handleCommanderSearch(request);
}

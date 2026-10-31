import { handleCardSearch } from "../../../../lib/server/card-search";

/** The deck workshop's card search: GET /api/cards/search?q=&id=bg&slot=draw&type=creature&mv=0-2 */
export async function GET(request: Request) {
  return handleCardSearch(request);
}

// Next.js calls onRequestError for any uncaught error in a route or page. It's counted for the
// /stats page (just the count, by kind); the details stay in the hosting provider's logs.
export async function onRequestError(_error: unknown, _request: unknown, context: { routeType?: string }) {
  const { count } = await import("./lib/server/stats");
  await count(context?.routeType === "route" ? "server_error|api" : "server_error|page");
}

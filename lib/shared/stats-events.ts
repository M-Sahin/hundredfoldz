// The events Hundredfoldz counts, shared by the server and the browser. Each one is a daily count
// (no ids, no addresses, nothing per person): "what happened how often", for the /stats page.
// An event is a name, optionally with one detail from a fixed list: "build_fail_why|no_deck".

const ACCESS = ["free", "own", "saved", "server", "demo"] as const;

export const SERVER_EVENTS = {
  /** a build started, by who pays for it */
  build_start: ACCESS,
  build_mode: ["new", "complete", "upgrade"],
  build_model: ["haiku", "sonnet", "opus", "other"],
  build_ok: ACCESS,
  build_fail: ACCESS,
  /** the visitor pressed Stop */
  build_stop: ACCESS,
  /** why a build ended without a deck */
  build_fail_why: ["bad_seeds", "not_commander", "unreadable_deck", "refused", "no_deck", "credit", "spend_limit", "bad_key", "no_access", "rate_limit", "overloaded", "error"],
  /** how long a finished build took */
  build_time: ["under_1m", "1_2m", "2_3m", "3_4m", "over_4m"],
  /** the free-build wall: why a visitor didn't get one */
  free_refused: ["used", "ip", "site"],
  key_check: ["ok", "bad"],
  key_saved: [],
  deck_saved: ["account"],
  share_link: [],
  login_email: [],
  account_deleted: [],
  /** an uncaught error in a server route */
  server_error: ["api", "page"],
} as const satisfies Record<string, readonly string[]>;

export const CLIENT_EVENTS = {
  /** the key sheet opened: because the free builds ran out, a build needs a key, or by hand */
  key_sheet: ["free_used", "needs_key", "opened"],
  deck_saved: ["browser"],
  export: ["moxfield", "arena", "txt"],
  buy: ["tcgplayer", "cardkingdom", "cardmarket", "other"],
  share_sheet: [],
  /** the deck workshop: opened with a commander, a deck brought in to edit, handed to Claude, saved */
  workshop: ["opened", "from_deck", "finish", "review", "saved"],
  /** an uncaught error in the page (its message is counted separately, cleaned up) */
  client_error: [],
} as const satisfies Record<string, readonly string[]>;

type Ev<T extends Record<string, readonly string[]>> = {
  [K in keyof T & string]: T[K] extends readonly [] ? K : `${K}|${T[K][number]}`;
}[keyof T & string];

export type ServerEvent = Ev<typeof SERVER_EVENTS>;
export type ClientEvent = Ev<typeof CLIENT_EVENTS>;

/** Is this one of the events the browser may send? */
export function isClientEvent(e: unknown): e is ClientEvent {
  if (typeof e !== "string" || e.length > 40) return false;
  const [name, detail, extra] = e.split("|");
  const details = (CLIENT_EVENTS as Record<string, readonly string[]>)[name];
  if (!details || extra !== undefined) return false;
  return details.length ? details.includes(detail) : detail === undefined;
}

/**
 * An error message, made safe to count: no numbers, ids, addresses or URLs, at most 80 characters.
 * "Cannot read properties of undefined (reading 'x')" stays readable; anything personal is gone.
 */
export function cleanErrorMessage(m: unknown): string {
  return String(m ?? "")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\S+@\S+/g, "<email>")
    .replace(/sk-ant-\S+/g, "<key>")
    .replace(/[0-9a-f]{8,}/gi, "#")
    .replace(/\d+/g, "#")
    .replace(/[^\w\s'.,:()<>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

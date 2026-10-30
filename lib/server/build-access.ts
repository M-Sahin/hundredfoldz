// The visitor's own Claude API key for a request: sent in a header for this request only, or the
// key saved to their account (sealed on the server; the browser never has it). Shared by builds
// (generate-handler.ts) and the workshop's card picks (coach-handler.ts).
import { savedKeyFor } from "./account-handler";
import { KEY_PATTERN } from "./key-vault";

export interface OwnKey {
  key: string;
  fromSaved: boolean;
  /** The model saved with the account's key, if any. */
  savedModel: string | null;
  /** Refreshed session cookies from opening the saved key. */
  setCookies: string[];
}

/** The key, null when the request has none, or the Response that refuses it. */
export async function ownKey(request: Request, ownKeysAllowed: boolean): Promise<OwnKey | null | Response> {
  let key = (request.headers.get("x-anthropic-key") ?? "").trim();
  let fromSaved = false;
  let savedModel: string | null = null;
  let setCookies: string[] = [];
  if (!key && request.headers.get("x-use-saved-key") === "1") {
    const saved = await savedKeyFor(request);
    if (!saved) return Response.json({ error: "The key saved to your account couldn't be used. Log in again, or add your key again.", code: "saved_key" }, { status: 400 });
    key = saved.key;
    fromSaved = true;
    savedModel = saved.model;
    setCookies = saved.setCookies;
  }
  if (!key) return null;
  if (!ownKeysAllowed) return Response.json({ error: "This site doesn't accept personal API keys." }, { status: 403 });
  if (!KEY_PATTERN.test(key)) return Response.json({ error: "That doesn't look like a Claude API key (they start with sk-ant-)." }, { status: 400 });
  return { key, fromSaved, savedModel, setCookies };
}

/** Short, non-reversible tag for a key, so limits can be per key instead of per shared IP. */
export async function keyTag(key: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return [...h.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

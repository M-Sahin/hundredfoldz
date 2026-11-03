// Visitors' own Claude API keys saved to their account, sealed with AES-256-GCM.
// KEY_ENCRYPTION_SECRET (32 random bytes, base64) lives only in the server's environment; the
// database holds the sealed key and its last four characters. The user's id is the additional
// data, so a sealed key copied to another user's row doesn't open.
// Make a secret with: openssl rand -base64 32
//
// Changing the secret: put the old one in KEY_ENCRYPTION_SECRET_PREVIOUS and the new one in
// KEY_ENCRYPTION_SECRET. Saved keys still open with the old secret, and each is sealed again with
// the new one the next time it's used (savedKeyFor), so nobody has to add their key again.

/** Claude API keys look like sk-ant-…; anything else is rejected before it reaches Anthropic. */
export const KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,200}$/;

// The secret: 32 bytes as base64 (what `openssl rand -base64 32` prints) are used as they are.
// Anything else at least 16 characters long (hex, base64 of fewer bytes, a long passphrase) is
// hashed into a key, so a secret in another format still works instead of switching saved keys off.
const current = () => (process.env.KEY_ENCRYPTION_SECRET ?? "").trim();
const previous = () => (process.env.KEY_ENCRYPTION_SECRET_PREVIOUS ?? "").trim();

function secretKind(raw = current()): "base64" | "hashed" | "missing" | "too-short" {
  if (!raw) return "missing";
  if (rawBytes(raw)?.length === 32) return "base64";
  return raw.length >= 16 ? "hashed" : "too-short";
}

function rawBytes(raw: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(raw.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export const vaultOn = () => {
  const k = secretKind();
  return k === "base64" || k === "hashed";
};

/** Why saved keys are off, for the site's owner (never the secret itself). */
export function vaultProblem(): string | null {
  const k = secretKind();
  if (k === "missing") return "KEY_ENCRYPTION_SECRET isn't set on the server (or the site wasn't redeployed after adding it).";
  if (k === "too-short") return "KEY_ENCRYPTION_SECRET is shorter than 16 characters: use 32 random bytes as base64 (openssl rand -base64 32).";
  return null;
}

async function aesKey(raw = current()): Promise<CryptoKey> {
  const kind = secretKind(raw);
  if (kind !== "base64" && kind !== "hashed") throw new Error(vaultProblem() ?? "KEY_ENCRYPTION_SECRET isn't usable.");
  const bytes = kind === "base64" ? rawBytes(raw)! : new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`hundredfoldz-key-vault:${raw}`)));
  return crypto.subtle.importKey("raw", bytes.slice(), "AES-GCM", false, ["encrypt", "decrypt"]);
}

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function sealKey(key: string, userId: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(userId) }, await aesKey(), new TextEncoder().encode(key)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64url(out);
}

async function openWith(sealed: string, userId: string, secret: string): Promise<string | null> {
  try {
    const b = fromB64url(sealed);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12), additionalData: new TextEncoder().encode(userId) }, await aesKey(secret), b.slice(12));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/**
 * The key, and whether it was sealed with the previous secret (so it should be sealed again).
 * Null when it doesn't open (another user's row, an unknown secret, a damaged value).
 */
export async function openSealed(sealed: string, userId: string): Promise<{ key: string; old: boolean } | null> {
  const key = await openWith(sealed, userId, current());
  if (key !== null) return { key, old: false };
  const prev = previous();
  if (!prev || prev === current()) return null;
  const oldKey = await openWith(sealed, userId, prev);
  return oldKey === null ? null : { key: oldKey, old: true };
}

/** The key, or null when it doesn't open. */
export async function openKey(sealed: string, userId: string): Promise<string | null> {
  return (await openSealed(sealed, userId))?.key ?? null;
}

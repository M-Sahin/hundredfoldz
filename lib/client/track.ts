// Counts an action for the /stats page (a daily count on the server: nothing about who did it).
// Fire and forget: never waits, never throws, and survives the page closing.
import type { ClientEvent } from "../shared/stats-events";
import { cleanErrorMessage } from "../shared/stats-events";

function send(body: unknown) {
  try {
    void fetch("/api/stats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
  } catch {
    /* counting is best-effort */
  }
}

export function track(e: ClientEvent) {
  send({ e });
}

let errors = 0;
/** Count uncaught page errors (a few per page load at most), with the message cleaned of anything personal. */
export function trackPageErrors(): () => void {
  const report = (m: unknown) => {
    if (errors >= 5) return;
    errors++;
    send({ e: "client_error", m: cleanErrorMessage(m) });
  };
  const onError = (ev: ErrorEvent) => report(ev.message || (ev.error as Error)?.message);
  const onRejection = (ev: PromiseRejectionEvent) => report((ev.reason as Error)?.message ?? ev.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

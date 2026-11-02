"use client";
// Pieces the profile and public deck pages share: the round picture, the like and view icons,
// dates, and the report dialog.
import { useEffect, useRef, useState } from "react";
import { report } from "../lib/client/community";
import { useAccount } from "../lib/client/account";
import { LIMITS } from "../lib/shared/community";
import { LoginDialog } from "./LoginDialog";

/** Dates fixed to one format, so the server's page and the browser's agree. */
export const monthYear = (at: number) => new Date(at).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
export const dayMonthYear = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The player's picture: a card's art in a circle, or their initial on the felt. */
export function Avatar({ art, name, size = 168, label }: { art: string | null | undefined; name: string; size?: number; label?: string }) {
  const style = { width: size, height: size, ["--avatar-size" as string]: `${size}px` };
  if (!art)
    return (
      <span className="avatar avatar--empty" style={style} role="img" aria-label={label ?? `${name}'s picture`}>
        <span aria-hidden>{(name.trim()[0] ?? "?").toUpperCase()}</span>
      </span>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="avatar" src={art} alt={label ?? `${name}'s picture`} width={size} height={size} style={style} loading="lazy" />;
}

export function HeartIcon({ filled = false, size = 18 }: { filled?: boolean; size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 20 20">
      <path d="M10 17 C4 12.5 2 10 2 7 A4 4 0 0 1 10 5 A4 4 0 0 1 18 7 C18 10 16 12.5 10 17 Z" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function EyeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 22 22">
      <path d="M2 11 C5 5.5 17 5.5 20 11 C17 16.5 5 16.5 2 11 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="11" cy="11" r="2.6" fill="currentColor" />
    </svg>
  );
}

/** "Report this deck" / "Report this profile": a reason, sent to the site's admins. Logged out: log in first. */
export function ReportButton({ target, what }: { target: { kind: "deck"; deck: string } | { kind: "profile"; handle: string }; what: string }) {
  const acct = useAccount();
  const [open, setOpen] = useState(false);
  const [login, setLogin] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);

  const send = async () => {
    setState("sending");
    setError(null);
    try {
      await report({ ...target, reason } as Parameters<typeof report>[0]);
      setState("sent");
    } catch (e) {
      setError((e as Error).message);
      setState("idle");
    }
  };

  return (
    <>
      <button type="button" className="link-btn report-btn" onClick={() => (acct.user ? setOpen(true) : setLogin(true))} data-testid="report">
        Report this {what}
      </button>
      <LoginDialog open={login} onClose={() => setLogin(false)} title={`Log in to report this ${what}`} lead="Reports come from accounts, so the admins can tell them apart. No password: an email link, Discord or Google." />
      <dialog ref={ref} className="modal report-modal" onClose={() => setOpen(false)} onClick={(e) => e.target === ref.current && setOpen(false)} aria-label={`Report this ${what}`}>
        {open ? (
          <div className="modal-inner report-inner">
            <h3>Report this {what}</h3>
            {state === "sent" ? (
              <>
                <p className="panel-sub" role="status">
                  Thanks. The site&apos;s admins will look. When three players report the same {what}, it comes down until they do.
                </p>
                <div className="deck-actions">
                  <button type="button" className="btn" onClick={() => setOpen(false)}>
                    Close
                  </button>
                </div>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <label className="opt">
                  <span className="opt-label">What&apos;s wrong with it?</span>
                  <textarea className="field" rows={3} maxLength={LIMITS.reason} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
                </label>
                <p className="opt-hint">
                  See the <a href="/community-rules">community rules</a>. Only the admins see reports.
                </p>
                {error ? <p className="error">{error}</p> : null}
                <div className="deck-actions">
                  <button type="submit" className="btn btn--brass" disabled={!reason.trim() || state === "sending"}>
                    {state === "sending" ? "Sending…" : "Send the report"}
                  </button>
                  <button type="button" className="btn btn--quiet" onClick={() => setOpen(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : null}
      </dialog>
    </>
  );
}

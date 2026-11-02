"use client";
// /admin: reported profiles and decks, for the site's admins (public.admins in the database).
// Keep it up or take it down; either way its reports are settled.
import { useEffect, useState } from "react";
import { useAccount } from "../lib/client/account";
import { adminApi, type ReportItem } from "../lib/client/community";
import { deckPath, profilePath } from "../lib/shared/community";
import { dayMonthYear } from "./Community";
import { LoginForm } from "./LoginForm";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

export default function AdminReports() {
  const acct = useAccount();
  const [items, setItems] = useState<ReportItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    adminApi
      .reports()
      .then(setItems)
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    if (acct.user) void load();
  }, [acct.user]);

  const act = async (r: ReportItem, remove: boolean) => {
    setBusy(r.target);
    setError(null);
    try {
      await adminApi.moderate(r.kind, r.target, remove);
      setItems((l) => (l ? l.filter((x) => x.target !== r.target) : l));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="app">
      <SiteHeader active={null} />
      <main className="account-page">
        <h1>Reports</h1>
        <div className="playmat page-mat">
          {acct.loaded && !acct.user ? (
            <section className="panel">
              <h3>Log in</h3>
              <LoginForm next="/admin" />
            </section>
          ) : null}
          {error ? <p className="error">{error}</p> : null}
          {items && !items.length ? <p className="panel-sub">Nothing reported. </p> : null}
          {items?.length ? (
            <ul className="admin-reports" data-testid="admin-reports">
              {items.map((r) => {
                const href = r.kind === "profile" ? (r.handle ? profilePath(r.handle) : null) : r.handle ? deckPath(r.handle, r.target) : null;
                return (
                  <li key={`${r.kind}:${r.target}`} className="zone">
                    <p className="zone-label">
                      {r.kind === "profile" ? "Profile" : "Deck"} · {r.count} report{r.count === 1 ? "" : "s"} · last {dayMonthYear(Date.parse(r.last))}
                      {r.removed ? " · down" : ""}
                    </p>
                    <h3>{href && !r.removed ? <a href={href}>{r.title ?? r.target}</a> : (r.title ?? r.target)}</h3>
                    {r.handle ? <p className="panel-sub">@{r.handle}</p> : null}
                    <ul className="admin-reasons">
                      {r.reasons.slice(0, 10).map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                    <div className="deck-actions">
                      <button type="button" className="btn" onClick={() => void act(r, false)} disabled={busy === r.target}>
                        {r.removed ? "Put it back up" : "Keep it up"}
                      </button>
                      <button type="button" className="btn btn--danger" onClick={() => void act(r, true)} disabled={busy === r.target}>
                        {r.removed ? "Keep it down" : "Take it down"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

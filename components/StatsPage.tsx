"use client";
// /stats: what happens on the site, from the daily counts (lib/server/stats.ts). Admins only
// (ADMIN_EMAILS); everyone else gets "nothing here". Counts are events, not people: a visitor who
// opens the key sheet twice counts twice, so the funnels are rough ratios, not exact conversion.
import { useEffect, useState } from "react";
import { SiteHeader } from "./SiteHeader";
import { ACCESS_LABEL, FAIL_LABEL, TIME_LABEL, TIME_ORDER, breakdown, buildsPerDay, pct, sum, topErrors, totals, type Day } from "../lib/shared/stats-summary";

type Load = { state: "loading" } | { state: "none" } | { state: "error"; message: string } | { state: "ok"; days: Day[]; store: string };

const RANGES = [7, 30, 90];

export default function StatsPage() {
  const [range, setRange] = useState(30);
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    let live = true;
    setLoad((l) => (l.state === "ok" ? l : { state: "loading" }));
    fetch(`/api/stats?days=${range}`, { cache: "no-store" })
      .then(async (r) => {
        if (!live) return;
        if (r.status === 404) return setLoad({ state: "none" });
        if (!r.ok) return setLoad({ state: "error", message: `The server answered ${r.status}.` });
        const j = await r.json();
        setLoad({ state: "ok", days: j.days, store: j.store });
      })
      .catch((e) => live && setLoad({ state: "error", message: (e as Error).message }));
    return () => {
      live = false;
    };
  }, [range]);

  return (
    <div className="app">
      <SiteHeader active={null} />
      <main className="stats-page">
        {load.state === "none" ? (
          <div className="prose">
            <h1>Nothing here</h1>
            <p>This page is for the people who run this site. Log in with an address listed in ADMIN_EMAILS to see it.</p>
          </div>
        ) : (
          <>
            <div className="stats-head">
              <h1>Stats</h1>
              <div className="stats-range" role="group" aria-label="Period">
                {RANGES.map((r) => (
                  <button key={r} type="button" className={`chip ${range === r ? "is-on" : ""}`} aria-pressed={range === r} onClick={() => setRange(r)}>
                    {r} days
                  </button>
                ))}
              </div>
            </div>
            <p className="stats-note">Daily counts of what happened, in UTC days. They count events, not people, so the funnels are rough ratios.</p>
            {load.state === "loading" ? <p className="stats-note">Loading…</p> : null}
            {load.state === "error" ? <p className="error">Couldn&apos;t load the stats. {load.message}</p> : null}
            {load.state === "ok" ? <Report days={load.days} store={load.store} /> : null}
          </>
        )}
      </main>
    </div>
  );
}

function Report({ days, store }: { days: Day[]; store: string }) {
  const t = totals(days);
  const started = sum(t, "build_start");
  const ok = sum(t, "build_ok");
  const fail = sum(t, "build_fail");
  const stop = sum(t, "build_stop");
  const access = ["free", "own", "saved", "server", "demo"].filter((a) => t[`build_start|${a}`]);
  const saves = sum(t, "deck_saved");
  const times = TIME_ORDER.map((k) => [TIME_LABEL[k], t[`build_time|${k}`] ?? 0] as [string, number]);
  const errors = topErrors(days);

  return (
    <>
      {store === "memory" ? <p className="note">No shared store is set up (Upstash), so these are only this server instance&apos;s counts since it started.</p> : null}

      <section className="stats-tiles" aria-label="Builds">
        <Tile label="Builds started" value={started} />
        <Tile label="Finished with a deck" value={ok} sub={rate(ok, ok + fail, "of those that ended")} />
        <Tile label="Failed" value={fail} sub={rate(fail, ok + fail, "of those that ended")} />
        <Tile label="Stopped by the visitor" value={stop} />
        <Tile label="Decks saved" value={saves} sub={rate(saves, ok, "of finished decks")} />
      </section>

      <section className="panel stats-panel">
        <h2>Builds per day</h2>
        <DayChart days={days} />
      </section>

      <div className="stats-grid">
        <section className="panel stats-panel">
          <h2>Who pays for the builds</h2>
          {access.length ? (
            <table className="stats-table">
              <thead>
                <tr>
                  <th scope="col">Access</th>
                  <th scope="col">Started</th>
                  <th scope="col">Finished</th>
                  <th scope="col">Failed</th>
                  <th scope="col">Stopped</th>
                </tr>
              </thead>
              <tbody>
                {access.map((a) => (
                  <tr key={a}>
                    <th scope="row">{ACCESS_LABEL[a] ?? a}</th>
                    <td>{n(t[`build_start|${a}`])}</td>
                    <td>
                      {n(t[`build_ok|${a}`])} <small>{pctText(t[`build_ok|${a}`] ?? 0, (t[`build_ok|${a}`] ?? 0) + (t[`build_fail|${a}`] ?? 0))}</small>
                    </td>
                    <td>{n(t[`build_fail|${a}`])}</td>
                    <td>{n(t[`build_stop|${a}`])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty />
          )}
        </section>

        <section className="panel stats-panel">
          <h2>Why builds failed</h2>
          <Bars rows={breakdown(t, "build_fail_why").map(([k, v]) => [FAIL_LABEL[k] ?? k, v])} tone="bad" />
        </section>

        <section className="panel stats-panel">
          <h2>How long a finished build took</h2>
          <Bars rows={times} keepZero />
        </section>

        <section className="panel stats-panel">
          <h2>The key wall</h2>
          <p className="stats-hint">From running out of free builds to building with an own key.</p>
          <Funnel
            steps={[
              ["Free build refused: used up", t["free_refused|used"] ?? 0],
              ["Key sheet shown for that", t["key_sheet|free_used"] ?? 0],
              ["Keys checked and working", t["key_check|ok"] ?? 0],
              ["Builds on an own or saved key", (t["build_start|own"] ?? 0) + (t["build_start|saved"] ?? 0)],
            ]}
          />
          <Facts
            rows={[
              ["Free builds refused: address limit", t["free_refused|ip"]],
              ["Free builds refused: site's daily limit", t["free_refused|site"]],
              ["Key sheet opened by hand", t["key_sheet|opened"]],
              ["Key sheet for a build that needs a key", t["key_sheet|needs_key"]],
              ["Keys that didn't work", t["key_check|bad"]],
              ["Keys saved to an account", t["key_saved"]],
            ]}
          />
        </section>

        <section className="panel stats-panel">
          <h2>After the deck</h2>
          <Funnel
            steps={[
              ["Decks finished", ok],
              ["Saved", saves],
              ["Share sheet opened", t["share_sheet"] ?? 0],
              ["Short links made", t["share_link"] ?? 0],
            ]}
          />
          <Facts
            rows={[
              ["Saved to an account", t["deck_saved|account"]],
              ["Saved in the browser", t["deck_saved|browser"]],
              ["Copied for Moxfield or Archidekt", t["export|moxfield"]],
              ["Copied for MTG Arena", t["export|arena"]],
              ["Downloaded as .txt", t["export|txt"]],
              ...breakdown(t, "buy").map(([k, v]) => [`Shop: ${shopName(k)}`, v] as [string, number]),
            ]}
          />
        </section>

        <section className="panel stats-panel">
          <h2>What was built</h2>
          <Facts
            rows={[
              ["From five seeds", t["build_mode|new"]],
              ["Completing a deck", t["build_mode|complete"]],
              ["Upgrading a deck", t["build_mode|upgrade"]],
              ...breakdown(t, "build_model").map(([k, v]) => [`Model: ${k[0].toUpperCase()}${k.slice(1)}`, v] as [string, number]),
            ]}
          />
        </section>

        <section className="panel stats-panel">
          <h2>Accounts</h2>
          <Facts
            rows={[
              ["Login emails sent", t["login_email"]],
              ["Keys saved to an account", t["key_saved"]],
              ["Accounts deleted", t["account_deleted"]],
            ]}
          />
        </section>

        <section className="panel stats-panel">
          <h2>Errors</h2>
          <Facts
            rows={[
              ["Server errors in API routes", t["server_error|api"]],
              ["Server errors in pages", t["server_error|page"]],
              ["Page errors in browsers", t["client_error"]],
            ]}
          />
          {errors.length ? (
            <>
              <h3>Most common page errors</h3>
              <ol className="stats-errors">
                {errors.map(([m, v]) => (
                  <li key={m}>
                    <code>{m}</code> <span>{n(v)}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}

const fmt = new Intl.NumberFormat("en");
const n = (v: number | undefined) => fmt.format(v ?? 0);
const pctText = (a: number, b: number) => {
  const p = pct(a, b);
  return p === null ? "" : `${p}%`;
};
const rate = (a: number, b: number, of: string) => {
  const p = pct(a, b);
  return p === null ? undefined : `${p}% ${of}`;
};
const SHOPS: Record<string, string> = { tcgplayer: "TCGplayer", cardkingdom: "Card Kingdom", cardmarket: "Cardmarket" };
const shopName = (k: string) => SHOPS[k] ?? "other";

function Tile({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="stats-tile">
      <span className="stats-tile-value">{n(value)}</span>
      <span className="stats-tile-label">{label}</span>
      {sub ? <span className="stats-tile-sub">{sub}</span> : null}
    </div>
  );
}

function Empty() {
  return <p className="stats-hint">Nothing yet in this period.</p>;
}

function Facts({ rows }: { rows: [string, number | undefined][] }) {
  return (
    <dl className="stats-facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{n(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Horizontal bars, one row each, with the number written out (the bar only helps compare). */
function Bars({ rows, tone, keepZero }: { rows: [string, number][]; tone?: "bad"; keepZero?: boolean }) {
  const shown = keepZero ? rows : rows.filter(([, v]) => v > 0);
  const max = Math.max(1, ...shown.map(([, v]) => v));
  if (!shown.some(([, v]) => v > 0)) return <Empty />;
  return (
    <ul className="stats-bars">
      {shown.map(([k, v]) => (
        <li key={k} title={`${k}: ${n(v)}`}>
          <span className="stats-bars-label">{k}</span>
          <span className="stats-bars-track">
            <span className={`stats-bars-fill ${tone === "bad" ? "is-bad" : ""}`} style={{ width: `${(v / max) * 100}%` }} />
          </span>
          <span className="stats-bars-value">{n(v)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Each step as a bar against the first, with its share of the step before. */
function Funnel({ steps }: { steps: [string, number][] }) {
  const first = Math.max(1, steps[0][1]);
  if (!steps.some(([, v]) => v > 0)) return <Empty />;
  return (
    <ol className="stats-funnel">
      {steps.map(([k, v], i) => {
        const prev = i ? steps[i - 1][1] : 0;
        // more than the step before (one key, many builds) isn't a conversion rate: leave it out
        const p = i && v <= prev ? pct(v, prev) : null;
        return (
          <li key={k} title={`${k}: ${n(v)}`}>
            <span className="stats-bars-label">{k}</span>
            <span className="stats-bars-track">
              <span className="stats-bars-fill" style={{ width: `${Math.min(100, (v / first) * 100)}%` }} />
            </span>
            <span className="stats-bars-value">
              {n(v)}
              {p !== null ? <small> {p}%</small> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Builds that ended each day: finished (bar) with failed stacked on top; hover for the numbers. */
function DayChart({ days }: { days: Day[] }) {
  const rows = buildsPerDay(days);
  const max = Math.max(1, ...rows.map((r) => r.ok + r.fail));
  const [hover, setHover] = useState<number | null>(null);
  if (!rows.some((r) => r.ok + r.fail + r.stop)) return <Empty />;
  const h = hover !== null ? rows[hover] : null;
  return (
    <div className="stats-chart">
      <div className="stats-legend">
        <span>
          <i className="sw sw-ok" /> Finished
        </span>
        <span>
          <i className="sw sw-bad" /> Failed
        </span>
        <span className="stats-readout" aria-live="polite">
          {h ? `${h.date}: ${n(h.ok)} finished, ${n(h.fail)} failed, ${n(h.stop)} stopped` : `Most in a day: ${n(max)}`}
        </span>
      </div>
      <div className="stats-cols" onMouseLeave={() => setHover(null)}>
        {rows.map((r, i) => (
          <button
            key={r.date}
            type="button"
            className={`stats-col ${hover === i ? "is-hover" : ""}`}
            aria-label={`${r.date}: ${r.ok} finished, ${r.fail} failed, ${r.stop} stopped`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onClick={() => setHover(i)}
          >
            <span className="stats-col-stack">
              {r.fail ? <span className="stats-col-fail" style={{ height: `${(r.fail / max) * 100}%` }} /> : null}
              {r.ok ? <span className="stats-col-ok" style={{ height: `${(r.ok / max) * 100}%` }} /> : null}
            </span>
          </button>
        ))}
      </div>
      <div className="stats-axis">
        <span>{rows[0]?.date}</span>
        <span>{rows[rows.length - 1]?.date}</span>
      </div>
    </div>
  );
}

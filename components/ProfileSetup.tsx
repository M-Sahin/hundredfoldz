"use client";
// /account/profile: make your profile, or change it. A name, a handle (your page's address), a
// few words, a picture (any card's art) and which of your saved decks show on it.
import { useEffect, useMemo, useRef, useState } from "react";
import { autocomplete, cardByName, type SavedDeck } from "../lib/client/api";
import { cloudDecks, useAccount } from "../lib/client/account";
import { profileApi } from "../lib/client/community";
import { LIMITS, cleanHandle, profilePath, suggestHandle, type OwnProfile } from "../lib/shared/community";
import { Avatar } from "./Community";
import { LoginForm } from "./LoginForm";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

interface Art {
  card: string;
  art: string;
  artist: string | null;
}

// card art, looked up once per name for this visit
const artCache = new Map<string, Promise<Art | null>>();
function artOf(name: string): Promise<Art | null> {
  if (!artCache.has(name))
    artCache.set(
      name,
      cardByName(name)
        .then((c) => (c.artCrop ? { card: c.name, art: c.artCrop, artist: c.artist } : null))
        .catch(() => null),
    );
  return artCache.get(name)!;
}

type HandleState = { state: "idle" | "checking" | "free" | "taken" | "bad" };

export default function ProfileSetup() {
  const acct = useAccount();
  const [mine, setMine] = useState<OwnProfile | null | undefined>(undefined);
  const [decks, setDecks] = useState<SavedDeck[] | null>(null);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [chosen, setChosen] = useState<Art | null>(null);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [check, setCheck] = useState<HandleState>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [confirmDown, setConfirmDown] = useState(false);
  const [down, setDown] = useState(false);
  const edit = !!mine;

  // load what's there
  useEffect(() => {
    if (!acct.user) return;
    let live = true;
    void profileApi
      .mine()
      .then((p) => {
        if (!live) return;
        setMine(p);
        const n = p?.name ?? acct.user!.name;
        setName(n);
        setHandle(p?.handle ?? suggestHandle(n));
        setBio(p?.bio ?? "");
        if (p?.avatar) setChosen({ card: p.avatar.card, art: p.avatar.art, artist: p.avatar.artist });
      })
      .catch((e) => live && (setMine(null), setError({ message: (e as Error).message })));
    void cloudDecks
      .list()
      .then((l) => {
        if (!live) return;
        setDecks(l);
        setShown(Object.fromEntries(l.map((d) => [d.id, !d.hidden])));
      })
      .catch(() => live && setDecks([]));
    return () => {
      live = false;
    };
  }, [acct.user]);

  // is the handle free? (after a pause in typing)
  useEffect(() => {
    const h = cleanHandle(handle);
    if (!handle) return setCheck({ state: "idle" });
    if (!h) return setCheck({ state: "bad" });
    if (mine && h === mine.handle) return setCheck({ state: "free" });
    setCheck({ state: "checking" });
    const ctl = new AbortController();
    const t = setTimeout(() => {
      profileApi
        .checkHandle(h, ctl.signal)
        .then((r) => setCheck({ state: r.free ? "free" : "taken" }))
        .catch(() => !ctl.signal.aborted && setCheck({ state: "idle" }));
    }, 400);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [handle, mine]);

  const shownCount = decks ? decks.filter((d) => shown[d.id]).length : 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    const changed = (decks ?? []).filter((d) => shown[d.id] === !!d.hidden);
    try {
      const p = await profileApi.save({
        handle,
        name,
        bio,
        avatarCard: chosen?.card ?? null,
        hidden: changed.filter((d) => !shown[d.id]).map((d) => d.id),
        shown: changed.filter((d) => shown[d.id]).map((d) => d.id),
      });
      window.location.href = profilePath(p.handle);
    } catch (e) {
      const msg = (e as Error).message;
      setError({ message: msg, field: /handle/i.test(msg) ? "handle" : undefined });
      setBusy(false);
    }
  };

  const takeDown = async () => {
    setBusy(true);
    setError(null);
    try {
      await profileApi.remove();
      setDown(true);
      setMine(null);
    } catch (e) {
      setError({ message: (e as Error).message });
    } finally {
      setBusy(false);
      setConfirmDown(false);
    }
  };

  const handleNote =
    check.state === "bad" ? (
      <span className="opt-hint is-bad">3 to 24 letters, numbers or _ (no spaces).</span>
    ) : check.state === "taken" ? (
      <span className="opt-hint is-bad">@{cleanHandle(handle)} is taken. Try another.</span>
    ) : check.state === "free" ? (
      <span className="opt-hint is-ok">
        {mine && cleanHandle(handle) === mine.handle ? "Yours." : "Free."} Your page: {typeof window === "undefined" ? "" : window.location.host}
        {profilePath(cleanHandle(handle) ?? handle)}
      </span>
    ) : (
      <span className="opt-hint">Your page&apos;s address. Letters, numbers and _.</span>
    );

  return (
    <div className="app">
      <SiteHeader active={null} />
      <main className="profile-setup">
        <h1>{down ? "Your profile is down" : edit ? "Edit your profile" : "Create your profile"}</h1>
        <div className="playmat page-mat">
          {!acct.loaded ? <p className="panel-sub">Loading…</p> : null}
          {acct.loaded && !acct.enabled ? <p className="panel-sub">This copy of Hundredfoldz has no accounts, so there are no profiles either.</p> : null}
          {acct.loaded && acct.enabled && !acct.user ? (
            <section className="panel">
              <h3>Log in to make a profile</h3>
              <p className="panel-sub">A profile is a page other players can visit: your name, a picture, a few words and your decks.</p>
              <LoginForm next="/account/profile" />
            </section>
          ) : null}
          {down ? (
            <p className="panel-sub" role="status">
              Your page is gone, and your decks are off it. They&apos;re still in <a href="/decks">My decks</a>. You can make a new profile any time.
            </p>
          ) : null}
          {acct.user && mine !== undefined && !down ? (
            <form
              className="profile-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <p className="panel-sub profile-form-lead">{edit ? "Change your name, picture and words, and choose which decks people see." : "A page other players can visit: your name, a picture, a few words and your decks. Check the decks below before you save: they go public with your profile."}</p>
              <div className="profile-form-grid">
                <div className="profile-form-main">
                  <section className="zone" aria-labelledby="pf-you">
                    <h2 id="pf-you" className="zone-label">
                      You
                    </h2>
                    <div className="profile-form-row">
                      <label className="opt">
                        <span className="opt-label">Name on your profile</span>
                        <input className="field" value={name} maxLength={LIMITS.name} onChange={(e) => setName(e.target.value)} required data-testid="profile-name" />
                      </label>
                      <label className="opt">
                        <span className="opt-label">Handle</span>
                        <span className="field field--prefix">
                          <span aria-hidden>@</span>
                          <input value={handle} maxLength={24} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/^@/, ""))} required autoCapitalize="none" spellCheck={false} aria-invalid={check.state === "bad" || check.state === "taken" || error?.field === "handle" || undefined} data-testid="profile-handle" />
                        </span>
                        {handleNote}
                      </label>
                    </div>
                    <label className="opt">
                      <span className="opt-label">
                        A few words about you <span className="opt-muted">(optional)</span>
                      </span>
                      <textarea className="field" rows={3} maxLength={LIMITS.bio} value={bio} onChange={(e) => setBio(e.target.value)} data-testid="profile-bio" />
                      <span className="opt-hint">{LIMITS.bio - bio.length} characters left. Plain text; links show as text.</span>
                    </label>
                  </section>

                  <section className="zone" aria-labelledby="pf-decks">
                    <h2 id="pf-decks" className="zone-label">
                      Your decks{decks?.length ? ` · ${shownCount} of ${decks.length} on your profile` : ""}
                    </h2>
                    <p className="panel-sub">Saved decks show on your profile. Untick the ones you&apos;d rather keep to yourself; you can change this on any deck later. Decks you save from now on show too, unless you hide them.</p>
                    {decks === null ? <p className="panel-sub">Loading your decks…</p> : null}
                    {decks && !decks.length ? <p className="panel-sub">No decks in your account yet. Ones you save later show here.</p> : null}
                    {decks?.length ? (
                      <ul className="profile-deck-list" data-testid="profile-deck-list">
                        {decks.map((d) => (
                          <li key={d.id}>
                            <label className="check">
                              <input type="checkbox" checked={!!shown[d.id]} onChange={(e) => setShown((s) => ({ ...s, [d.id]: e.target.checked }))} />
                              <span className="profile-deck-name">
                                <strong>{d.name}</strong>
                                <span>{d.commander}</span>
                              </span>
                              <span className={shown[d.id] ? "is-ok" : "opt-muted"}>{shown[d.id] ? "On your profile" : "Hidden"}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                </div>

                <AvatarPicker chosen={chosen} onChoose={setChosen} commanders={decks?.map((d) => d.commander) ?? []} name={name || "You"} />
              </div>

              {error ? <p className="error">{error.message}</p> : null}
              <div className="deck-actions">
                <button type="submit" className="btn btn--brass" disabled={busy || !name.trim() || check.state === "bad" || check.state === "taken"} data-testid="profile-save">
                  {busy ? "Saving…" : edit ? "Save changes" : "Create my profile"}
                </button>
                <a className="btn btn--quiet" href={mine ? profilePath(mine.handle) : "/account"}>
                  Cancel
                </a>
                {edit ? (
                  confirmDown ? (
                    <span className="profile-down-confirm" role="group" aria-label="Take your profile down?">
                      <span>Take your page down? Your decks stay in My decks.</span>
                      <button type="button" className="btn btn--small btn--danger" onClick={() => void takeDown()} disabled={busy}>
                        Take it down
                      </button>
                      <button type="button" className="btn btn--small btn--quiet" onClick={() => setConfirmDown(false)}>
                        Keep it
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="link-btn link-btn--danger profile-down" onClick={() => setConfirmDown(true)}>
                      Take my profile down
                    </button>
                  )
                ) : null}
              </div>
              <p className="opt-hint">
                Your email is never shown. Others can like your public decks; you see the likes and views. Deleting your account deletes your profile, your decks and your likes. See the <a href="/community-rules">community rules</a>.
              </p>
            </form>
          ) : null}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

/** Pick any card's art: your commanders first, then a search by name. */
function AvatarPicker({ chosen, onChoose, commanders, name }: { chosen: Art | null; onChoose: (a: Art | null) => void; commanders: string[]; name: string }) {
  const [q, setQ] = useState("");
  const [names, setNames] = useState<string[]>([]);
  const [arts, setArts] = useState<Art[]>([]);
  const [loading, setLoading] = useState(false);
  const own = useMemo(() => [...new Set(commanders)].slice(0, 6), [commanders]);
  const seq = useRef(0);

  // names for the search, after a pause in typing
  useEffect(() => {
    if (q.trim().length < 2) return setNames(own);
    const ctl = new AbortController();
    const t = setTimeout(() => {
      autocomplete(q.trim(), ctl.signal)
        .then((r) => setNames(r.slice(0, 6)))
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, own]);

  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true);
    void Promise.all(names.map(artOf)).then((r) => {
      if (mine !== seq.current) return;
      setArts(r.filter((x): x is Art => !!x));
      setLoading(false);
    });
  }, [names]);

  return (
    <section className="zone avatar-picker" aria-labelledby="pf-pic">
      <h2 id="pf-pic" className="zone-label">
        Your picture
      </h2>
      <div className="avatar-picker-now">
        <Avatar art={chosen?.art} name={name} size={112} label={chosen ? `Chosen picture: ${chosen.card}` : "No picture yet"} />
        <span>
          <strong>{chosen ? chosen.card : "No picture yet"}</strong>
          {chosen?.artist ? <span>art by {chosen.artist}, shown under your picture</span> : <span>Pick a card below.</span>}
          {chosen ? (
            <button type="button" className="link-btn" onClick={() => onChoose(null)}>
              Remove the picture
            </button>
          ) : null}
        </span>
      </div>
      <label className="opt">
        <span className="opt-label">Pick any Magic card&apos;s art</span>
        <input className="field" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a card name" data-testid="avatar-search" />
      </label>
      <div className="avatar-grid" role="radiogroup" aria-label="Card art" aria-busy={loading || undefined}>
        {arts.map((a) => (
          <button
            key={a.card}
            type="button"
            role="radio"
            aria-checked={chosen?.card === a.card}
            className={`avatar-option ${chosen?.card === a.card ? "is-on" : ""}`}
            style={{ backgroundImage: `url("${a.art}")` }}
            onClick={() => onChoose(a)}
            title={a.artist ? `${a.card}, art by ${a.artist}` : a.card}
          >
            <span>{a.card}</span>
          </button>
        ))}
      </div>
      {!arts.length && !loading ? <p className="panel-sub">{q.trim().length >= 2 ? "No cards by that name." : "Search for a card to use its art."}</p> : null}
      <p className="opt-hint">Art crops from Scryfall. {own.length ? "Your commanders come first; search for any other card." : ""}</p>
    </section>
  );
}

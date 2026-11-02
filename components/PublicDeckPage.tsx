"use client";
// /u/<handle>/<deck>: one of a player's public decks. The usual deck view, plus who made it, their
// words about it, likes and views. Visitors can like it (logged in), save a copy or take it into
// the workshop; its player can change the description or hide it from their profile.
import { useEffect, useState } from "react";
import { handoff, myDecks, resolveDeck } from "../lib/client/api";
import { cloudDecks, useAccount } from "../lib/client/account";
import { countView, likesApi, useMyProfile } from "../lib/client/community";
import { track } from "../lib/client/track";
import { LIMITS, deckPath, profilePath, shortCount, type PublicDeck, type PublicDeckSummary } from "../lib/shared/community";
import type { Color, Deck, Validation } from "../lib/shared/types";
import { Avatar, EyeIcon, HeartIcon, ReportButton, dayMonthYear } from "./Community";
import { DeckView } from "./DeckView";
import { LoginDialog } from "./LoginDialog";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { TableArt } from "./TableArt";

export default function PublicDeckPage({ deck: pd, more }: { deck: PublicDeck; more: PublicDeckSummary[] }) {
  const acct = useAccount();
  const me = useMyProfile();
  const owner = !!me && me.handle === pd.author.handle;
  const [state, setState] = useState<{ deck: Deck; validation: Validation } | { error: string } | null>(null);
  const [likes, setLikes] = useState(pd.likes);
  const [liked, setLiked] = useState<boolean | null>(null);
  const [views, setViews] = useState(pd.views);
  const [login, setLogin] = useState<string | null>(null);
  const [saved, setSaved] = useState<"saving" | "account" | "browser" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState(pd.description);
  const [editing, setEditing] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const firstName = pd.author.name.split(/\s+/)[0] || pd.author.name;

  useEffect(() => {
    let live = true;
    resolveDeck(pd.d)
      .then((r) => live && setState({ ...r, deck: { ...r.deck, name: pd.name } }))
      .catch((e) => live && setState({ error: (e as Error).message }));
    // a view, once per visitor a day (the server decides)
    countView(pd.id)
      .then((v) => live && v !== null && setViews(v))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pd.d, pd.id, pd.name]);

  useEffect(() => {
    if (!acct.user || owner) return;
    let live = true;
    likesApi
      .get(pd.id)
      .then((v) => live && setLiked(v))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [acct.user, owner, pd.id]);

  const toggleLike = async () => {
    if (!acct.user) return setLogin("like");
    const on = !liked;
    setLiked(on);
    setLikes((n) => Math.max(0, n + (on ? 1 : -1)));
    setError(null);
    try {
      await likesApi.set(pd.id, on);
    } catch (e) {
      setLiked(!on);
      setLikes((n) => Math.max(0, n + (on ? -1 : 1)));
      setError((e as Error).message);
    }
  };

  const saveCopy = async () => {
    setSaved("saving");
    setError(null);
    const copy = { id: `copy-${pd.id}`, at: Date.now(), name: pd.name, commander: pd.commander, ...(pd.partner ? { partner: pd.partner } : {}), colors: pd.colors as Color[], d: pd.d };
    try {
      if (acct.user) {
        await cloudDecks.save(copy, pd.id);
        setSaved("account");
      } else {
        myDecks.add(copy);
        setSaved("browser");
      }
      if (!acct.user) track("deck_saved|browser"); // account saves are counted by the server
    } catch (e) {
      setSaved(null);
      setError((e as Error).message);
    }
  };

  const editInWorkshop = () => {
    handoff.set({ kind: "edit", d: pd.d, name: pd.name });
    window.location.href = "/workshop";
  };

  const saveDescription = async () => {
    if (editing === null) return;
    const text = editing;
    setError(null);
    try {
      await cloudDecks.update(pd.id, { description: text });
      setDescription(text.trim());
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const setShown = async (show: boolean) => {
    setError(null);
    try {
      await cloudDecks.update(pd.id, { hidden: !show });
      setHidden(!show);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const byline = (
    <a className="deck-byline" href={profilePath(pd.author.handle)} data-testid="deck-byline">
      <Avatar art={pd.author.avatarArt} name={pd.author.name} size={40} />
      <span>
        <strong>{pd.author.name}</strong>
        <span>
          @{pd.author.handle} · {dayMonthYear(pd.at)}
        </span>
      </span>
    </a>
  );

  const about = (
    <section className="deck-about" aria-label={`About this deck, from ${firstName}`}>
      {description || owner || pd.basedOn ? <h3 className="zone-label">About this deck, from {firstName}</h3> : null}
      {editing !== null ? (
        <form
          className="deck-about-edit"
          onSubmit={(e) => {
            e.preventDefault();
            void saveDescription();
          }}
        >
          <textarea className="field" rows={5} maxLength={LIMITS.description} value={editing} onChange={(e) => setEditing(e.target.value)} aria-label="Description" autoFocus />
          <p className="opt-hint">{LIMITS.description - editing.length} characters left. Plain text; links show as text.</p>
          <div className="deck-actions">
            <button type="submit" className="btn btn--small">
              Save
            </button>
            <button type="button" className="btn btn--small btn--quiet" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : description ? (
        <p className="deck-about-text">{description}</p>
      ) : owner ? (
        <p className="panel-sub">No description yet. Say what the deck does and how it wins, in your own words.</p>
      ) : null}
      {owner && editing === null ? (
        <button type="button" className="link-btn" onClick={() => setEditing(description)} data-testid="edit-description">
          {description ? "Edit the description" : "Write a description"}
        </button>
      ) : null}
      {pd.basedOn ? (
        <p className="deck-based-on">
          Based on <a href={deckPath(pd.basedOn.handle, pd.basedOn.id)}>{pd.basedOn.name}</a> by <a href={profilePath(pd.basedOn.handle)}>{pd.basedOn.author}</a>
        </p>
      ) : null}
    </section>
  );

  const likeButton = owner ? (
    <span className="well deck-counts" data-testid="deck-counts">
      <HeartIcon /> {shortCount(likes)}
      {views !== null ? (
        <>
          {" "}
          · <EyeIcon /> {shortCount(views)}
        </>
      ) : null}
    </span>
  ) : (
    <button type="button" className={liked ? "btn btn--liked" : "btn btn--brass"} aria-pressed={!!liked} onClick={() => void toggleLike()} data-testid="like">
      <HeartIcon filled={!!liked} /> {liked ? "Liked" : acct.user || !acct.enabled ? "Like" : "Log in to like"} · {shortCount(likes)}
    </button>
  );

  const saveSlot = owner ? null : saved === "account" || saved === "browser" ? (
    <a className="btn btn--saved" href="/decks">
      Saved to My decks
    </a>
  ) : (
    <button type="button" className="btn" onClick={() => void saveCopy()} disabled={saved === "saving"} data-testid="save-copy">
      {saved === "saving" ? "Saving…" : "Save a copy"}
    </button>
  );

  return (
    <div className="app">
      <TableArt src={state && "deck" in state ? state.deck.commander.info?.artCrop : null} />
      <SiteHeader active={null} />
      <main className="public-deck">
        {!state ? <p className="loading">Loading the deck and its cards from Scryfall…</p> : null}
        {state && "error" in state ? (
          <div className="alert">
            <strong>{state.error}</strong>
          </div>
        ) : null}
        {state && "deck" in state ? (
          <>
            <DeckView deck={state.deck} validation={state.validation} shareD={pd.d} byline={byline} about={about} leadAction={likeButton} saveSlot={saveSlot} onEdit={editInWorkshop} />
            {error ? <p className="error public-deck-error">{error}</p> : null}
            {owner ? (
              <section className="zone public-deck-owner">
                <label className="check">
                  <input type="checkbox" checked={!hidden} onChange={(e) => void setShown(e.target.checked)} data-testid="show-on-profile" />
                  <span>Show on my profile</span>
                </label>
                <p className="panel-sub">{hidden ? "Hidden: this page is gone for everyone else, and the deck is off your profile. Tick the box to bring it back." : "Anyone can see this page. Hide it to keep the deck to yourself; share links you've sent keep working."}</p>
              </section>
            ) : null}
          </>
        ) : null}

        {more.length ? (
          <section className="public-deck-more" aria-labelledby="more-decks">
            <h2 id="more-decks" className="zone-label">
              More decks by {firstName} · <a href={profilePath(pd.author.handle)}>See all</a>
            </h2>
            <ul className="pdeck-more">
              {more.map((d) => (
                <li key={d.id}>
                  <a href={deckPath(pd.author.handle, d.id)}>
                    <span className="pdeck-more-art" style={d.art ? { backgroundImage: `url("${d.art}")` } : undefined} aria-hidden />
                    <span>
                      <strong>{d.name}</strong>
                      <span>
                        {shortCount(d.likes)} like{d.likes === 1 ? "" : "s"}
                        {d.views !== null ? ` · ${shortCount(d.views)} views` : ""}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="public-deck-foot">
          {views !== null ? (
            <>
              <EyeIcon size={15} /> {shortCount(views)} view{views === 1 ? "" : "s"}, counted once per visitor a day.{" "}
            </>
          ) : null}
          {!owner ? <ReportButton target={{ kind: "deck", deck: pd.id }} what="deck" /> : null}
        </p>
      </main>
      <LoginDialog open={login !== null} onClose={() => setLogin(null)} title="Log in to like decks" lead="Likes come from accounts, one per player. No password: an email link, Discord or Google." next={deckPath(pd.author.handle, pd.id)} />
      <SiteFooter />
    </div>
  );
}

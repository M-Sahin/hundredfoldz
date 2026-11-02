"use client";
// /u/<handle>: a player's page. Their picture (a card's art), name, a few words and their public
// decks, sortable by newest, most liked and most viewed. The player sees their hidden decks too.
import { useEffect, useMemo, useState } from "react";
import { cloudDecks } from "../lib/client/account";
import { commanderArt } from "../lib/client/card-art";
import { useMyProfile } from "../lib/client/community";
import { deckPath, profilePath, shortCount, sortDecks, type DeckSort, type PublicDeckSummary, type PublicProfile } from "../lib/shared/community";
import type { Color } from "../lib/shared/types";
import { IdentityPips } from "./CardFace";
import { Avatar, EyeIcon, HeartIcon, ReportButton, dayMonthYear, monthYear } from "./Community";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { TableArt } from "./TableArt";

const SORTS: [DeckSort, string][] = [
  ["new", "Newest"],
  ["liked", "Most liked"],
  ["viewed", "Most viewed"],
];

export default function ProfilePage({ profile }: { profile: PublicProfile }) {
  const me = useMyProfile();
  const owner = !!me && me.handle === profile.handle;
  const [sort, setSort] = useState<DeckSort>("new");
  const [hidden, setHidden] = useState<PublicDeckSummary[]>([]);
  const [copied, setCopied] = useState(false);
  const counted = profile.decks.some((d) => d.views !== null);

  // the player's own hidden decks, shown to them only
  useEffect(() => {
    if (!owner) return;
    let live = true;
    cloudDecks
      .list()
      .then((all) => live && setHidden(all.filter((d) => d.hidden).map((d) => ({ id: d.id, name: d.name, commander: d.commander, partner: d.partner ?? null, colors: d.colors, likes: d.likes ?? 0, views: null, at: d.at, hidden: true }))))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [owner]);

  const decks = useMemo(() => sortDecks([...profile.decks, ...hidden], sort), [profile.decks, hidden, sort]);
  const likes = profile.decks.reduce((n, d) => n + d.likes, 0);
  const views = profile.decks.reduce((n, d) => n + (d.views ?? 0), 0);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${profilePath(profile.handle)}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {}
  };

  return (
    <div className="app">
      <TableArt src={profile.avatar?.art} />
      <SiteHeader active={null} />
      <main className="profile-page">
        <div className="playmat page-mat profile-mat">
          <section className="profile-head" aria-labelledby="profile-name">
            <figure className="profile-pic">
              <Avatar art={profile.avatar?.art} name={profile.name} label={profile.avatar ? `${profile.name}'s picture: the art of ${profile.avatar.card}` : undefined} />
              {profile.avatar ? (
                <figcaption>
                  {profile.avatar.card}
                  {profile.avatar.artist ? `, art by ${profile.avatar.artist}` : ""}
                </figcaption>
              ) : null}
            </figure>
            <div className="profile-who">
              <div className="profile-names">
                <h1 id="profile-name">{profile.name}</h1>
                <span className="profile-handle">@{profile.handle}</span>
              </div>
              {profile.bio ? <p className="profile-bio">{profile.bio}</p> : null}
              <p className="profile-since">Playing here since {monthYear(profile.at)}</p>
              <dl className="profile-stats">
                <div className="well">
                  <dt>Decks</dt>
                  <dd>{profile.decks.length}</dd>
                </div>
                <div className="well">
                  <dt>Likes</dt>
                  <dd>{shortCount(likes)}</dd>
                </div>
                {counted ? (
                  <div className="well">
                    <dt>Views</dt>
                    <dd>{shortCount(views)}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
            <div className="profile-side">
              {owner ? (
                <a className="btn" href="/account/profile" data-testid="edit-profile">
                  Edit profile
                </a>
              ) : null}
              <button type="button" className="link-btn" onClick={() => void copyLink()}>
                {copied ? "Link copied" : "Copy profile link"}
              </button>
              {!owner ? <ReportButton target={{ kind: "profile", handle: profile.handle }} what="profile" /> : null}
            </div>
          </section>

          <section className="zone profile-decks" aria-labelledby="profile-decks">
            <div className="profile-decks-head">
              <h2 id="profile-decks" className="zone-label">
                Decks · {decks.length}
              </h2>
              {decks.length > 1 ? (
                <div className="viewswitch" role="group" aria-label="Sort decks">
                  {SORTS.filter(([s]) => s !== "viewed" || counted).map(([s, label]) => (
                    <button key={s} type="button" className={`viewswitch-btn ${sort === s ? "is-on" : ""}`} aria-pressed={sort === s} onClick={() => setSort(s)}>
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {owner ? (
              <p className="panel-sub">
                Your saved decks show here. Hidden decks are only shown to you. Hide or show a deck on its page, in <a href="/decks">My decks</a> or on <a href="/account/profile">Edit profile</a>.
              </p>
            ) : null}
            {decks.length ? (
              <ul className="decks-grid" data-testid="profile-decks">
                {decks.map((d) => (
                  <ProfileDeck key={d.id} deck={d} handle={profile.handle} counted={counted} />
                ))}
              </ul>
            ) : (
              <p className="panel-sub">{owner ? "No decks yet. Decks you save to your account show here." : `${profile.name} hasn't shared a deck yet.`}</p>
            )}
          </section>
          <p className="deck-art-credit">Card art from Scryfall. © Wizards of the Coast</p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function ProfileDeck({ deck: d, handle, counted }: { deck: PublicDeckSummary; handle: string; counted: boolean }) {
  const [art, setArt] = useState<string | null>(d.art ?? null);
  useEffect(() => {
    if (d.art !== undefined) return;
    let live = true;
    void commanderArt(d.commander).then((u) => live && setArt(u));
    return () => {
      live = false;
    };
  }, [d.art, d.commander]);
  // hidden decks have no public page: they open in My decks
  const href = d.hidden ? "/decks" : deckPath(handle, d.id);
  return (
    <li className={`deckcard pdeck ${d.hidden ? "is-hidden" : ""}`}>
      <a className="deckcard-art" href={href} style={art ? { backgroundImage: `url("${art}")` } : undefined} aria-label={`Open ${d.name}`} title={d.artist ? `${d.commander}, art by ${d.artist}` : undefined}>
        <span className="deckcard-pips">
          <IdentityPips colors={d.colors as Color[]} size={14} />
        </span>
        {d.hidden ? <span className="pdeck-hidden">Hidden</span> : null}
      </a>
      <div className="deckcard-body">
        <h3 className="deckcard-name">
          <a href={href}>{d.name}</a>
        </h3>
        <p className="deckcard-cmd">
          {d.commander}
          {d.partner ? ` + ${d.partner}` : ""}
          {d.bracket ? ` · Bracket ${d.bracket}` : ""}
        </p>
        <p className="pdeck-meta">
          <span>
            <HeartIcon size={15} /> {shortCount(d.likes)} like{d.likes === 1 ? "" : "s"}
          </span>
          {counted && d.views !== null ? (
            <span>
              <EyeIcon size={16} /> {shortCount(d.views)} view{d.views === 1 ? "" : "s"}
            </span>
          ) : null}
          <span className="pdeck-date">{dayMonthYear(d.at)}</span>
        </p>
      </div>
    </li>
  );
}

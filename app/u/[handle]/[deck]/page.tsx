// /u/<handle>/<deck>: one public deck. A deck that moved to another handle redirects there.
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import PublicDeckPage from "../../../../components/PublicDeckPage";
import { loadPublicDeck, loadPublicProfile } from "../../../../lib/server/community-handler";
import { deckMetadata } from "../../../../lib/server/deck-meta";
import { deckPath, sortDecks } from "../../../../lib/shared/community";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string; deck: string }> };

async function load(props: Props) {
  const { deck } = await props.params;
  return loadPublicDeck(deck).catch(() => null);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const d = await load(props);
  if (!d) return { title: "Deck not found · Hundredfoldz", robots: { index: false } };
  const path = deckPath(d.author.handle, d.id);
  const m = await deckMetadata(d.d, path);
  const title = `${d.name} by ${d.author.name} · Hundredfoldz`;
  const description = (d.description || (typeof m.description === "string" ? m.description : "") || `A Commander deck led by ${d.commander}.`).slice(0, 200);
  return { ...m, title, description, alternates: { canonical: path }, openGraph: { ...m.openGraph, title, description }, twitter: { ...m.twitter, title, description } };
}

export default async function Page(props: Props) {
  const { handle } = await props.params;
  const d = await load(props);
  if (!d) notFound();
  if (decodeURIComponent(handle).toLowerCase() !== d.author.handle) permanentRedirect(deckPath(d.author.handle, d.id));
  const profile = await loadPublicProfile(d.author.handle).catch(() => null);
  const more = sortDecks((profile?.decks ?? []).filter((x) => x.id !== d.id), "liked").slice(0, 3);
  return <PublicDeckPage deck={d} more={more} />;
}

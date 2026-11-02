// /u/<handle>: a player's profile and public decks (lib/server/community-handler.ts loads them).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ProfilePage from "../../../components/ProfilePage";
import { loadPublicProfile } from "../../../lib/server/community-handler";
import { requestOrigin } from "../../../lib/server/deck-meta";
import { profilePath } from "../../../lib/shared/community";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string }> };

async function load(props: Props) {
  const { handle } = await props.params;
  return loadPublicProfile(decodeURIComponent(handle)).catch(() => null);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const p = await load(props);
  if (!p) return { title: "Player not found · Hundredfoldz", robots: { index: false } };
  const base = await requestOrigin();
  const title = `${p.name} (@${p.handle}) · Hundredfoldz`;
  const description = (p.bio || `${p.name}'s Commander decks on Hundredfoldz: ${p.decks.length} deck${p.decks.length === 1 ? "" : "s"}.`).slice(0, 200);
  return {
    title,
    description,
    metadataBase: new URL(base),
    alternates: { canonical: profilePath(p.handle) },
    openGraph: { title, description, type: "profile", url: `${base}${profilePath(p.handle)}`, ...(p.avatar ? { images: [{ url: p.avatar.art }] } : {}) },
    twitter: { card: "summary", title, description, ...(p.avatar ? { images: [p.avatar.art] } : {}) },
  };
}

export default async function Page(props: Props) {
  const p = await load(props);
  if (!p) notFound();
  return <ProfilePage profile={p} />;
}

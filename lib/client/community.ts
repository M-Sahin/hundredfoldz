"use client";
// Profiles and public decks from the browser: your own profile, likes, views, reports, moderation.
import { useEffect, useState } from "react";
import { call, useAccount } from "./account";
import type { OwnProfile } from "../shared/community";

export const profileApi = {
  mine: () => call<{ profile: OwnProfile | null }>("/api/profile").then((j) => j.profile),
  save: (p: { handle: string; name: string; bio: string; avatarCard: string | null; hidden?: string[]; shown?: string[] }) =>
    call<{ profile: OwnProfile }>("/api/profile", { method: "PUT", body: JSON.stringify(p) }).then((j) => j.profile),
  remove: () => call<{ removed: boolean }>("/api/profile", { method: "DELETE" }),
  checkHandle: (h: string, signal?: AbortSignal) => call<{ valid: boolean; free: boolean; handle?: string }>(`/api/profile/handle?h=${encodeURIComponent(h)}`, { signal }),
};

export const likesApi = {
  get: (deck: string) => call<{ liked: boolean }>(`/api/likes?deck=${encodeURIComponent(deck)}`).then((j) => j.liked),
  set: (deck: string, on: boolean) => call<{ liked: boolean }>("/api/likes", { method: "POST", body: JSON.stringify({ deck, on }) }).then((j) => j.liked),
};

export const countView = (deck: string) => call<{ views: number | null }>("/api/views", { method: "POST", body: JSON.stringify({ deck }) }).then((j) => j.views);

export const report = (r: { kind: "deck"; deck: string; reason: string } | { kind: "profile"; handle: string; reason: string }) => call<{ reported: boolean }>("/api/report", { method: "POST", body: JSON.stringify(r) });

export interface ReportItem {
  kind: "deck" | "profile";
  target: string;
  count: number;
  last: string;
  reasons: string[];
  removed: boolean;
  title: string | null;
  handle: string | null;
}
export const adminApi = {
  reports: () => call<{ reports: ReportItem[] }>("/api/admin/reports").then((j) => j.reports),
  moderate: (kind: "deck" | "profile", target: string, remove: boolean) => call("/api/admin/reports", { method: "POST", body: JSON.stringify({ kind, target, remove }) }),
};

/** The logged-in player's profile: undefined while loading, null for none (or logged out). */
export function useMyProfile(): OwnProfile | null | undefined {
  const acct = useAccount();
  const [p, setP] = useState<OwnProfile | null | undefined>(undefined);
  useEffect(() => {
    if (!acct.loaded) return;
    if (!acct.user) {
      setP(null);
      return;
    }
    let live = true;
    profileApi
      .mine()
      .then((x) => live && setP(x))
      .catch(() => live && setP(null));
    return () => {
      live = false;
    };
  }, [acct.loaded, acct.user]);
  return p;
}

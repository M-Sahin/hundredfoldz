import type { Metadata } from "next";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteHeader } from "../../components/SiteHeader";
import { REPORTS_TO_HIDE } from "../../lib/shared/community";

export const metadata: Metadata = { title: "Community rules · Hundredfoldz", alternates: { canonical: "/community-rules" } };

// What may go on profiles and public decks, and what happens when something breaks the rules.
export default function Page() {
  return (
    <div className="app">
      <SiteHeader active={null} />
      <main className="account-page prose playmat page-mat">
        <h1>Community rules</h1>
        <p>Profiles and public decks are for sharing Commander decks and talking about Magic. Keep it friendly, the way you would at a game store.</p>
        <h3>Not allowed</h3>
        <ul>
          <li>Insults, harassment or threats, aimed at anyone.</li>
          <li>Hate: attacks on people for who they are (race, religion, gender, sexuality, disability, where they&apos;re from).</li>
          <li>Sexual content, or anything that isn&apos;t fine for a mixed table of players.</li>
          <li>Spam and ads: selling things, links to other sites, the same deck posted over and over.</li>
          <li>Pretending to be someone else, including Wizards of the Coast, a store or a known player.</li>
          <li>Someone else&apos;s private details: names, addresses, phone numbers.</li>
        </ul>
        <h3>What happens</h3>
        <ul>
          <li>Anyone with an account can report a profile or a deck. Only the site&apos;s admins see reports.</li>
          <li>When {REPORTS_TO_HIDE} players report the same profile or deck, it comes down until an admin looks.</li>
          <li>An admin keeps it up or takes it down. A profile that comes down takes its decks off the site with it. Its player still has their decks in My decks.</li>
          <li>Someone who keeps breaking the rules loses their profile.</li>
        </ul>
        <h3>Your own things</h3>
        <ul>
          <li>You choose which of your decks show on your profile, and can hide any of them or take your profile down at any time.</li>
          <li>Others can like your public decks, save a copy or take one into the workshop. A copy says which deck it&apos;s based on.</li>
          <li>Your email is never shown.</li>
        </ul>
        <p>
          Something wrong that a report doesn&apos;t cover? Open an issue on <a href="https://github.com/M-Sahin/hundredfoldz/issues">GitHub</a>.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}

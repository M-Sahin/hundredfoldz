import type { Metadata } from "next";
import App from "../components/App";
import { HomeInfo } from "../components/HomeInfo";
import { JsonLd } from "../components/JsonLd";
import { faq, HOME_TITLE, SITE_DESCRIPTION, SITE_NAME, publicOrigin } from "../lib/server/site";

export const metadata: Metadata = {
  title: HOME_TITLE,
  description: SITE_DESCRIPTION,
  // ?opening=… (from My decks) and ?view=deck (a deck on screen) are the same page
  alternates: { canonical: "/" },
};

// /?opening=open&name=…: coming from My decks; the "Opening …" screen is rendered on the server
// too, so a slow phone doesn't show the setup page while the deck loads.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  // /?view=deck&name=…: the address while a deck is on screen; a reload shows "Opening …" until
  // the browser puts the deck back from this tab's storage
  const kind = typeof q.opening === "string" && ["open", "rebuild", "upgrade", "complete"].includes(q.opening) ? (q.opening as "open" | "rebuild" | "upgrade" | "complete") : q.view === "deck" ? "open" : null;
  const name = typeof q.name === "string" ? q.name.slice(0, 120) : "your deck";
  const o = await publicOrigin();
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "WebSite", "@id": `${o}/#site`, name: SITE_NAME, url: `${o}/`, description: SITE_DESCRIPTION, inLanguage: "en" },
            {
              "@type": "WebApplication",
              "@id": `${o}/#app`,
              name: SITE_NAME,
              url: `${o}/`,
              description: SITE_DESCRIPTION,
              applicationCategory: "GameApplication",
              applicationSubCategory: "Magic: The Gathering Commander deck builder",
              operatingSystem: "Any (web browser)",
              browserRequirements: "Requires JavaScript",
              isAccessibleForFree: true,
              offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
              featureList: [
                "Builds a legal 100-card Commander (EDH) deck from five seed cards",
                "Commander brackets 1 to 4, with budget options",
                "Completes a partial decklist or suggests up to 10 upgrades",
                "Builds from your own collection",
                "Every card checked on Scryfall; combos checked with Commander Spellbook",
                "Mana curve, opening-hand odds and price",
                "Export to Moxfield, Archidekt and MTG Arena",
                "Free Commander bracket checker and booster box EV calculator",
              ],
              author: { "@type": "Person", name: "Murat Sahin", url: "https://github.com/M-Sahin" },
              sameAs: ["https://github.com/M-Sahin/hundredfoldz"],
            },
            {
              "@type": "FAQPage",
              "@id": `${o}/#faq`,
              mainEntity: faq().map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
            },
          ],
        }}
      />
      <App opening={kind ? { kind, name } : null} info={<HomeInfo />} />
    </>
  );
}

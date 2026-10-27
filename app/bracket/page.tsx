import type { Metadata } from "next";
import BracketChecker from "../../components/BracketChecker";
import { JsonLd } from "../../components/JsonLd";
import { breadcrumbs, publicOrigin } from "../../lib/server/site";

export const metadata: Metadata = {
  title: "Commander bracket checker · Hundredfoldz",
  description: "Paste any Commander decklist and see which bracket it fits: Game Changers, combos, mass land denial and extra turns, checked against Scryfall and Commander Spellbook. Free.",
  alternates: { canonical: "/bracket" },
};

export default async function Page() {
  const o = await publicOrigin();
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "WebApplication",
              name: "Commander bracket checker",
              url: `${o}/bracket`,
              description: "Paste a Commander decklist and see the lowest bracket (1 to 5) it fits, the cards that decide it and a legality check. Uses Wizards of the Coast's Commander Brackets, Scryfall and Commander Spellbook.",
              applicationCategory: "GameApplication",
              operatingSystem: "Any (web browser)",
              isAccessibleForFree: true,
              offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
              isPartOf: { "@id": `${o}/#site` },
            },
            breadcrumbs(o, [["Bracket checker", "/bracket"]]),
          ],
        }}
      />
      <BracketChecker />
    </>
  );
}

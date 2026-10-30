import type { Metadata } from "next";
import Workshop from "../../components/Workshop";
import { JsonLd } from "../../components/JsonLd";
import { breadcrumbs, publicOrigin } from "../../lib/server/site";

export const metadata: Metadata = {
  title: "Deck workshop: build a Commander deck yourself · Hundredfoldz",
  description: "Build a Commander deck card by card. Search Commander-legal cards in your commander's colors and see lands, ramp, card draw, removal, legality and the bracket add up as you go. Free, no key needed.",
  alternates: { canonical: "/workshop" },
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
              name: "Commander deck workshop",
              url: `${o}/workshop`,
              description: "Build a Magic: The Gathering Commander deck yourself: pick a commander, add cards from a search limited to its colors, and see the deck's lands, ramp, card draw, removal, legality and bracket checked as you build.",
              applicationCategory: "GameApplication",
              operatingSystem: "Any (web browser)",
              isAccessibleForFree: true,
              offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
              isPartOf: { "@id": `${o}/#site` },
            },
            breadcrumbs(o, [["Deck workshop", "/workshop"]]),
          ],
        }}
      />
      <Workshop />
    </>
  );
}

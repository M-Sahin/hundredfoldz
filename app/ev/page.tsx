import type { Metadata } from "next";
import EvIndexView from "../../components/EvIndexView";
import { evIndex } from "../../lib/server/ev-data";
import { JsonLd } from "../../components/JsonLd";
import { breadcrumbs, publicOrigin } from "../../lib/server/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/ev" },
  title: "MTG booster box EV calculator · Hundredfoldz",
  description: "What every Magic booster box since 2020 is worth on average: card value from the published pack odds and Cardmarket prices, after selling costs. Free, no account.",
};

export default async function Page() {
  let index = null;
  let error: string | null = null;
  try {
    index = await evIndex();
    if (!index) error = "No Box EV data has been published yet. It's built once a day by the ev-data workflow.";
  } catch {
    error = "The Box EV data couldn't be loaded. Try again in a minute.";
  }
  const o = await publicOrigin();
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            breadcrumbs(o, [["Box EV", "/ev"]]),
            ...(index
              ? [
                  {
                    "@type": "ItemList",
                    name: "Magic: The Gathering booster box EV",
                    itemListElement: index.products.slice(0, 50).map((p, i) => ({ "@type": "ListItem", position: i + 1, url: `${o}/ev/${p.id}`, name: `${p.name.replace(/ Booster$/, "")} box` })),
                  },
                ]
              : []),
          ],
        }}
      />
      <EvIndexView index={index} error={error} />
    </>
  );
}

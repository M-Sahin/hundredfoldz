import type { Metadata } from "next";
import EvProductView from "../../../components/EvProductView";
import { evProduct } from "../../../lib/server/ev-data";
import { KIND_LABEL } from "../../../lib/shared/ev";
import { JsonLd } from "../../../components/JsonLd";
import { breadcrumbs, publicOrigin } from "../../../lib/server/site";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

async function load(props: Props) {
  const { id } = await props.params;
  try {
    return { product: await evProduct(id), error: null as string | null };
  } catch {
    return { product: null, error: "The Box EV data couldn't be loaded. Try again in a minute." };
  }
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { product } = await load(props);
  if (!product) return { title: "Box EV · Hundredfoldz", robots: { index: false } };
  return {
    alternates: { canonical: `/ev/${product.id}` },
    title: `${product.setName} ${KIND_LABEL[product.kind]} box EV · Hundredfoldz`,
    description: `What a ${product.setName} ${KIND_LABEL[product.kind]} box is worth on average, after selling costs, and your chance to get your money back. From the published pack odds and Cardmarket prices.`,
  };
}

export default async function Page(props: Props) {
  const { product, error } = await load(props);
  const o = await publicOrigin();
  return (
    <>
      {product ? <JsonLd data={{ "@context": "https://schema.org", ...breadcrumbs(o, [["Box EV", "/ev"], [`${product.setName} ${KIND_LABEL[product.kind]} box`, `/ev/${product.id}`]]) }} /> : null}
      <EvProductView product={product} error={error ?? (product ? null : "We don't have data for that box.")} />
    </>
  );
}

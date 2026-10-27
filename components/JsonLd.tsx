// Structured data for search engines and AI assistants (schema.org, as JSON-LD). It's a data block,
// not a script, but it carries the page's CSP nonce like every other script tag.
import { headers } from "next/headers";

export async function JsonLd({ data }: { data: unknown }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

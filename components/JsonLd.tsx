// Structured data for search engines and AI assistants (schema.org, as JSON-LD). It's a data block,
// not a script, so the Content Security Policy doesn't need to allow it.
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

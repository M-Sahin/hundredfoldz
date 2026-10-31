/** The commander's art, blurred and dark, lying on the table behind the page (the deck page, the workshop, the
 *  seeds on the home page). Decoration only: the same art is on the card face on screen, with its artist. */
export function TableArt({ src }: { src: string | null | undefined }) {
  if (!src) return null;
  // keyed by the image, so a new commander fades in instead of swapping in place
  return <div key={src} className="table-art" aria-hidden style={{ ["--table-art" as string]: `url("${src}")` }} />;
}

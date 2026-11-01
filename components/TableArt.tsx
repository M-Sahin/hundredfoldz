/** The commander's art, blurred and dark, lying on the table behind the page (the deck page, the workshop, the
 *  seeds on the home page). Decoration only: the same art is on the card face on screen, with its artist. */
export function TableArt({ src }: { src: string | null | undefined }) {
  if (!src) return null;
  // keyed by the image, so a new commander fades in instead of swapping in place
  // the art bleeds past the window so its blurred edges don't show; the frame clips it to the window,
  // so it never reaches past the screen's edge (CI's phone sweep checks that)
  return (
    <div className="table-art-frame" aria-hidden>
      <div key={src} className="table-art" style={{ ["--table-art" as string]: `url("${src}")` }} />
    </div>
  );
}

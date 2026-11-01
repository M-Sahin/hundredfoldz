// Claude's plan on the building screen. Claude writes one short line before each batch of tool
// calls; the one just before its first card search (after reading the seeds) says what the deck
// wants, so its first sentence goes on a paper note and the rest stays in the log.

export interface PlanNote {
  /** the log item that holds the plan */
  index: number;
  note: string;
  /** what follows the first sentence ("Searching for…"), shown as a plain log line */
  rest: string;
}

type Item = { kind: string; text?: string; name?: string };

const MAX = 220; // longer than this, it isn't a one-line plan: leave it as text

export function planNote(log: readonly Item[]): PlanNote | null {
  const search = log.findIndex((x) => x.kind === "tool" && x.name === "search_cards");
  if (search < 0) return null;
  // parallel calls arrive together: step back over the batch to the text before it
  let i = search - 1;
  while (i >= 0 && log[i].kind === "tool") i--;
  const item = log[i];
  if (!item || item.kind !== "text" || !item.text) return null;
  const text = item.text.trim();
  // a sentence ends at . ! or ? followed by a capital (or the end), so "e.g. this" doesn't cut it
  const m = text.match(/^([\s\S]+?[.!?])(?:\s+(?=[A-Z"“‘(])|$)/);
  if (!m) return null;
  const note = m[1].trim();
  if (note.length < 12 || note.length > MAX) return null;
  return { index: i, note, rest: text.slice(m[0].length).trim() };
}

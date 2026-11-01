// Claude's plan on the building screen: the line before its first card search.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planNote } from "../lib/shared/plan-note";

const seeds = { kind: "tool", name: "get_cards" };
const search = { kind: "tool", name: "search_cards" };

test("the line before the first search: its first sentence is the note, the rest stays in the log", () => {
  const log = [
    { kind: "status", text: "Reading your seeds" },
    { kind: "text", text: "Let me read the seeds first: a sacrifice-and-recursion core in black-green." },
    seeds,
    { kind: "text", text: "Meren wants sacrifice outlets, death payoffs and cheap recursive creatures. Searching for the best ones in Golgari." },
    search,
    search,
    search,
    { kind: "text", text: "I have what I need." },
  ];
  assert.deepEqual(planNote(log), { index: 3, note: "Meren wants sacrifice outlets, death payoffs and cheap recursive creatures.", rest: "Searching for the best ones in Golgari." });
});

test("a one-sentence line is all note; parallel calls before the search are stepped over", () => {
  const log = [{ kind: "text", text: "Tokens and +1/+1 counters, so I need anthems and doublers." }, seeds, search];
  assert.deepEqual(planNote(log), { index: 0, note: "Tokens and +1/+1 counters, so I need anthems and doublers.", rest: "" });
});

test("no note before the first search, with no text before it, or with a line too long or unfinished", () => {
  assert.equal(planNote([{ kind: "text", text: "Reading the seeds first." }, seeds]), null);
  assert.equal(planNote([seeds, search]), null);
  assert.equal(planNote([{ kind: "text", text: "Looking for ramp and" }, search]), null);
  assert.equal(planNote([{ kind: "text", text: `${"word ".repeat(60)}end.` }, search]), null);
  // a status line between the text and the search: the text wasn't about the search
  assert.equal(planNote([{ kind: "text", text: "The seeds want graveyard value." }, { kind: "status", text: "Writing" }, search]), null);
});

test("only a sentence end followed by a capital cuts the note", () => {
  const p = planNote([{ kind: "text", text: "Spells matter, e.g. cheap cantrips and copy effects. Looking for them." }, search]);
  assert.equal(p?.note, "Spells matter, e.g. cheap cantrips and copy effects.");
  assert.equal(p?.rest, "Looking for them.");
});

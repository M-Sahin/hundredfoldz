// Under the builder on the home page: what Hundredfoldz is, how a build works, the free tools and
// the common questions. Server-rendered, so it's there for search engines and AI assistants that
// read the page without running it, and for people who scroll down to find out what this is.
import { faq } from "../lib/server/site";

const STEPS: [string, string][] = [
  ["Pick five cards", "Any five Commander-legal cards you want to play, with a commander among them or not. Choose a bracket (1 to 4) and a budget."],
  ["Watch Claude build", "Claude, Anthropic's AI, plans the deck, searches Scryfall for every card it needs and writes the list. You see every step, live."],
  ["Get a checked deck", "The server checks all 100 cards before you see them: legality, color identity, the bracket's rules and combos. Then you get the strategy, the numbers and where to buy it."],
];

export function HomeInfo() {
  return (
    <section className="home-info" aria-labelledby="home-info-title">
      <h2 id="home-info-title">A Commander deck builder that does the deckbuilding</h2>
      <p className="home-info-lead">
        Hundredfoldz is a free, open-source deck builder for Magic: The Gathering&apos;s Commander (EDH) format. Instead of handing you a list of popular cards, it builds the whole deck around the cards you picked: the commander, the plan, 36 or so lands, ramp, card draw, removal and the synergy pieces, in the power bracket your playgroup uses.
      </p>

      <ol className="home-steps">
        {STEPS.map(([title, text], i) => (
          <li key={title} className="home-step">
            <span className="home-step-n" aria-hidden="true">
              {i + 1}
            </span>
            <h3>{title}</h3>
            <p>{text}</p>
          </li>
        ))}
      </ol>

      <div className="home-tools">
        <a className="home-tool" href="/workshop">
          <h3>Deck workshop</h3>
          <p>Build a deck yourself, card by card, with live checks for lands, ramp, draw, removal and legality. Free, no key.</p>
        </a>
        <a className="home-tool" href="/bracket">
          <h3>Commander bracket checker</h3>
          <p>Paste any decklist and see which bracket it fits, with the cards that decide it. Free, no key.</p>
        </a>
        <a className="home-tool" href="/ev">
          <h3>Booster box EV</h3>
          <p>What every booster box since 2020 is worth on average, and your chance to get your money back.</p>
        </a>
        <a className="home-tool" href="https://github.com/M-Sahin/hundredfoldz" target="_blank" rel="noopener noreferrer">
          <h3>Open source</h3>
          <p>The code is on GitHub, and you can host your own copy. Decks are built with the MTG Master Claude Skill.</p>
        </a>
      </div>

      <h2>Questions</h2>
      <div className="home-faq">
        {faq().map((f) => (
          <details key={f.q} className="home-faq-item">
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

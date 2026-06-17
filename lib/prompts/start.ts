/**
 * Server-only prompts for the pre-discovery qualifier teaser (/start).
 * Never imported into client bundles.
 *
 * The teaser is the prospect-facing "wow" shown on submit: a high-level,
 * explicitly INDICATIVE read of the size of their opportunity, built from the
 * services they want to be found for + their location + their chosen channel.
 * It is not a full audit — ~60%-accurate volume framing is fine here, as long
 * as it's labelled indicative and written as a visitor/customer outcome, never
 * as raw keyword/click jargon.
 */

export const TEASER_SYSTEM_PROMPT = (
  "You are a senior digital strategist at Zib Digital, an Australian digital " +
  "agency. A prospect has filled in a short pre-discovery form before a sales " +
  "call. Your job is to produce a SHORT, high-level, INDICATIVE teaser that " +
  "makes them feel the size of their opportunity — not a full audit.\n\n" +
  "Use web search to ground an approximate monthly search-demand figure for " +
  "what they do in their location, preferring Australian sources. Be " +
  "conservative and realistic — round to a clean approximate number. Roughly " +
  "right beats precisely wrong; this is explicitly labelled indicative.\n\n" +
  "Voice rules:\n" +
  "- Plain English, no marketing jargon. Never say 'clicks', 'impressions', " +
  "'CTR', 'keywords' or 'search volume' to the prospect.\n" +
  "- Frame everything as people / customers / opportunities, not metrics.\n" +
  "- Use 'likely' / 'typically' / 'around' framing. No guarantees, no hype.\n" +
  "- 'nextSteps' are 2-3 plain things Zib would look at next — not a keyword " +
  "dump and not generic filler.\n\n" +
  "Respond with ONLY a single minified JSON object, no prose, no markdown fences."
);

type TeaserInput = {
  services: string;
  location: string;
  channel: string; // "Google Ads" | "SEO" | "Social" | "Not sure"
  industry: string;
  goal: string;
};

export const teaserUserPrompt = (d: TeaserInput) =>
  `A prospect wants to be found for: "${d.services}".\n` +
  `Their business / what they do: "${d.industry || "(not specified)"}".\n` +
  `Target location(s): "${d.location || "Australia"}".\n` +
  `Primary goal: "${d.goal}".\n` +
  `Channel they're most interested in: "${d.channel}".\n\n` +
  `Return JSON with EXACTLY these fields:\n` +
  `{"volume": <approx number of people per month searching for what they do ` +
  `in their location — a clean rounded integer, or 0 if you genuinely can't ` +
  `estimate>,` +
  `"volumeNote": "<≤120 chars, plain-English basis for the figure, no jargon>",` +
  `"channelRead": "<one sentence tailored to their chosen channel (${d.channel}), ` +
  `written as a visitor/customer outcome. For Google Ads use a rough ` +
  `cost-per-opportunity framing; for SEO note they're likely missing ` +
  `non-branded demand; for Social frame reach-to-customer; for 'Not sure' ` +
  `recommend the most likely best-fit channel and why — all in plain English>",` +
  `"nextSteps": ["<2-3 plain bullets of what Zib would look at next, each a complete thought of ≤ 18 words / one short line>"],` +
  `"confidence": "low|medium|high"}\n` +
  `Keep volume realistic (0 to 5,000,000). Never invent precision.`;

/**
 * Lead qualification — the single rule that decides whether a tool lead is
 * worth the sales team's time.
 *
 * WHY THIS EXISTS
 * The tools used to ask their qualifying questions *after* the lead was
 * captured, while the pack or audit generated. Answering was optional and
 * the payoff arrived either way, so a large share of leads carried no
 * qualifying data at all and every lead looked identical to the ad
 * platforms. The questions now run *before* the payoff, which means every
 * lead arrives with answers — and this module turns those answers into a
 * tier that drives three things:
 *
 *   1. What the visitor sees next  (calendar embed vs. email follow-up)
 *   2. Which conversion event fires (see assets/conversion.js)
 *   3. What sales sees in HubSpot   (tier + score on the contact)
 *
 * ⚠️ MIRRORED IN THE BROWSER. `assets/conversion.js` carries a copy of these
 * rules so the page can branch without a round-trip. `lib/qualify.test.ts`
 * asserts the two stay in step — if you change a threshold here, change it
 * there, and the test will tell you if you forgot.
 *
 * The thresholds deliberately match the /start pre-discovery qualifier
 * (api/start.ts): >=62 is green, <38 is red. Same scale, same meaning, so a
 * tool lead and a pre-discovery lead can be compared directly.
 */

export type QualifyTier = "qualified" | "review" | "nurture";

/** Stable keys sent by the chip buttons. Labels live on the page. */
export type QualifyAnswers = {
  /** Monthly ad/marketing spend — the strongest single signal. */
  spend?: string;
  /** How soon they want help. Audit only; labs don't ask. */
  timeline?: string;
  /** Who runs marketing today. Audit only. */
  marketing?: string;
  /** What matters most. Labs only — captured for the strategist, not scored. */
  goal?: string;
};

export type QualifyResult = {
  tier: QualifyTier;
  /** 0-100, same scale as api/start.ts opportunityScore. */
  score: number;
  /** Plain-English lines for the HubSpot note and the internal email. */
  reasons: string[];
  /** Whether this lead should reach a human. Nurture tier never does. */
  salesReady: boolean;
};

/**
 * Spend carries most of the weight. Someone already spending $3k+/month has
 * a budget, an agency or a team, and a reason to switch — the three things
 * that separate a real opportunity from someone collecting a free report.
 */
const SPEND_SCORE: Record<string, number> = {
  "10k-plus": 85,
  "3k-10k": 70,
  "1k-3k": 45,
  "under-1k": 20,
  none: 8,
};

/** Timeline moves a borderline lead either way. "Just researching" sinks one. */
const TIMELINE_SCORE: Record<string, number> = {
  asap: 15,
  "1-3-months": 8,
  "later-this-year": -2,
  researching: -20,
};

/**
 * Who runs marketing is a weak signal on its own, but "an agency" means the
 * budget already exists and is already being spent somewhere else.
 */
const MARKETING_SCORE: Record<string, number> = {
  agency: 10,
  "in-house": 5,
  myself: 0,
  "no-one": 2,
};

export const SPEND_LABEL: Record<string, string> = {
  "10k-plus": "$10k+",
  "3k-10k": "$3k – $10k",
  "1k-3k": "$1k – $3k",
  "under-1k": "Under $1k",
  none: "Nothing yet",
};

export const TIMELINE_LABEL: Record<string, string> = {
  asap: "ASAP",
  "1-3-months": "Next 1–3 months",
  "later-this-year": "Later this year",
  researching: "Just researching",
};

export const MARKETING_LABEL: Record<string, string> = {
  agency: "An agency",
  "in-house": "In-house team",
  myself: "I do it myself",
  "no-one": "No one right now",
};

export const GOAL_LABEL: Record<string, string> = {
  "more-leads": "More leads",
  "cheaper-leads": "Cheaper leads",
  "new-market": "New market or launch",
  competitor: "Beating a competitor",
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Score a set of chip answers.
 *
 * An unanswered spend question scores 0 and lands in nurture. That's
 * deliberate: the questions now gate the payoff, so a lead with no spend
 * answer got here some other way and hasn't told us anything.
 */
export function qualify(answers: QualifyAnswers): QualifyResult {
  const spend = answers.spend || "";
  const timeline = answers.timeline || "";
  const marketing = answers.marketing || "";

  const spendScore = SPEND_SCORE[spend] ?? 0;
  const score = clamp(spendScore + (TIMELINE_SCORE[timeline] ?? 0) + (MARKETING_SCORE[marketing] ?? 0));

  // "Just researching" is a stated intent, not a guess — honour it even when
  // the spend number looks good. A researcher with a big budget is a real
  // lead later, and a wasted call today.
  const researching = timeline === "researching";
  // No budget at all can't be scored past, whatever else they answered.
  const noBudget = spend === "none" || spend === "under-1k";

  let tier: QualifyTier;
  if (noBudget || researching || score < 38) tier = "nurture";
  else if (score >= 62) tier = "qualified";
  else tier = "review";

  const reasons: string[] = [];
  if (spend) reasons.push(`Monthly spend: ${SPEND_LABEL[spend] || spend}`);
  if (timeline) reasons.push(`Timeline: ${TIMELINE_LABEL[timeline] || timeline}`);
  if (marketing) reasons.push(`Marketing run by: ${MARKETING_LABEL[marketing] || marketing}`);
  if (answers.goal) reasons.push(`Priority: ${GOAL_LABEL[answers.goal] || answers.goal}`);
  if (noBudget) reasons.push("No meaningful budget yet — nurture, don't call.");
  else if (researching) reasons.push("Self-identified as researching — nurture, don't call.");

  return { tier, score, reasons, salesReady: tier !== "nurture" };
}

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
 * asserts the two stay in step — if you change a weight here, change it
 * there, and the test will tell you if you forgot.
 *
 * The weights and thresholds deliberately track the /start pre-discovery
 * qualifier (api/start.ts): deal value and spend dominate, >=62 is green,
 * <38 is red. Same scale, same meaning, so a tool lead and a pre-discovery
 * lead can be compared directly.
 */

export type QualifyTier = "qualified" | "review" | "nurture";

/** Stable keys sent by the chip buttons. Labels live on the page. */
export type QualifyAnswers = {
  /** What a new customer is worth. The single best predictor of fit. */
  dealValue?: string;
  /** Monthly ad/marketing spend. */
  spend?: string;
  /** How soon they want help. Audit only; the labs don't ask. */
  timeline?: string;
  /** Whether they're already running ads. Audit only. */
  running?: string;
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
 * Each dimension scores 0-100 on its own, then they're combined by the
 * weights below. Splitting it this way means a tool that asks three
 * questions and a tool that asks five land on the same scale — see
 * `qualify()` for how missing dimensions are handled.
 */
const DEAL_SCORE: Record<string, number> = {
  lt500: 5, "500-2k": 35, "2k-10k": 70, "10k-50k": 90, gt50k: 100, unsure: 40,
};

const SPEND_SCORE: Record<string, number> = {
  none: 8, "under-1k": 20, "1k-3k": 50, "3k-10k": 80, "10k-plus": 100,
};

const TIMELINE_SCORE: Record<string, number> = {
  asap: 100, "1-3-months": 70, "later-this-year": 30, researching: 0,
};

/**
 * Already running ads means the budget exists, is already being spent
 * somewhere, and can move. "No" isn't disqualifying — plenty of good leads
 * haven't started — so it sits mid-range rather than at zero.
 */
const RUNNING_SCORE: Record<string, number> = { yes: 100, no: 40, unsure: 50 };

const MARKETING_SCORE: Record<string, number> = {
  agency: 100, "in-house": 70, myself: 30, "no-one": 40,
};

/**
 * Weighted like /start's opportunityScore: deal value and spend together
 * carry roughly two thirds. /start also folds in a search-volume estimate;
 * the tools have no equivalent, so that weight is spread across the two
 * that matter most.
 */
const WEIGHTS: Record<string, number> = {
  dealValue: 0.32,
  spend: 0.32,
  timeline: 0.18,
  running: 0.09,
  marketing: 0.09,
};

const SCORES: Record<string, Record<string, number>> = {
  dealValue: DEAL_SCORE,
  spend: SPEND_SCORE,
  timeline: TIMELINE_SCORE,
  running: RUNNING_SCORE,
  marketing: MARKETING_SCORE,
};

export const DEAL_LABEL: Record<string, string> = {
  lt500: "Under $500", "500-2k": "$500 – $2k", "2k-10k": "$2k – $10k",
  "10k-50k": "$10k – $50k", gt50k: "$50k+", unsure: "Not sure",
};

export const SPEND_LABEL: Record<string, string> = {
  "10k-plus": "$10k+", "3k-10k": "$3k – $10k", "1k-3k": "$1k – $3k",
  "under-1k": "Under $1k", none: "Nothing yet",
};

export const TIMELINE_LABEL: Record<string, string> = {
  asap: "ASAP", "1-3-months": "Next 1–3 months",
  "later-this-year": "Later this year", researching: "Just researching",
};

export const RUNNING_LABEL: Record<string, string> = {
  yes: "Yes, right now", no: "Not currently", unsure: "Not sure",
};

export const MARKETING_LABEL: Record<string, string> = {
  agency: "An agency", "in-house": "In-house team",
  myself: "I do it myself", "no-one": "No one right now",
};

export const GOAL_LABEL: Record<string, string> = {
  "more-leads": "More leads", "cheaper-leads": "Cheaper leads",
  "new-market": "New market or launch", competitor: "Beating a competitor",
};

/**
 * Score a set of chip answers.
 *
 * Only the dimensions actually answered contribute, and the weights are
 * renormalised across them. That's what lets the audit ask five questions
 * and the labs ask three without the labs being punished for the two they
 * skip — a lab lead with strong answers scores as well as an audit lead
 * with the same strength.
 *
 * An empty set scores 0 and lands in nurture. That's deliberate: the
 * questions now gate the payoff, so a lead with no answers got here some
 * other way and hasn't told us anything.
 */
export function qualify(answers: QualifyAnswers): QualifyResult {
  let weighted = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const answer = (answers as Record<string, string | undefined>)[key];
    if (!answer) continue;
    const sub = SCORES[key][answer];
    if (sub === undefined) continue; // unrecognised value — ignore, don't guess
    weighted += sub * weight;
    totalWeight += weight;
  }
  const score = totalWeight
    ? Math.max(0, Math.min(100, Math.round(weighted / totalWeight)))
    : 0;

  // Three overrides that beat the arithmetic, because they're stated facts
  // rather than estimates.
  //
  // No budget can't be scored past, whatever else they answered.
  const noBudget = answers.spend === "none" || answers.spend === "under-1k";
  // "Just researching" is an intent they told us. A researcher with a big
  // budget is a real lead later, and a wasted call today.
  const researching = answers.timeline === "researching";
  // Sub-$500 customers can't carry agency retainer maths. This caps the lead
  // at review rather than sinking it — same as /start, where lt500 blocks
  // green but doesn't on its own make a lead red.
  const tinyDeal = answers.dealValue === "lt500";

  let tier: QualifyTier;
  if (noBudget || researching || score < 38) tier = "nurture";
  else if (score >= 62 && !tinyDeal) tier = "qualified";
  else tier = "review";

  const reasons: string[] = [];
  if (answers.dealValue) reasons.push(`Customer value: ${DEAL_LABEL[answers.dealValue] || answers.dealValue}`);
  if (answers.spend) reasons.push(`Monthly spend: ${SPEND_LABEL[answers.spend] || answers.spend}`);
  if (answers.timeline) reasons.push(`Timeline: ${TIMELINE_LABEL[answers.timeline] || answers.timeline}`);
  if (answers.running) reasons.push(`Running ads: ${RUNNING_LABEL[answers.running] || answers.running}`);
  if (answers.marketing) reasons.push(`Marketing run by: ${MARKETING_LABEL[answers.marketing] || answers.marketing}`);
  if (answers.goal) reasons.push(`Priority: ${GOAL_LABEL[answers.goal] || answers.goal}`);
  if (noBudget) reasons.push("No meaningful budget yet — nurture, don't call.");
  else if (researching) reasons.push("Self-identified as researching — nurture, don't call.");
  else if (tinyDeal) reasons.push("Customer value under $500 — retainer maths is unlikely to work.");

  return { tier, score, reasons, salesReady: tier !== "nurture" };
}

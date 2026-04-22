/**
 * Google PageSpeed Insights wrapper.
 * Returns category scores (0-100) and the top 4 opportunity audits.
 */

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export type PsiResult = {
  url: string;
  scores: {
    performance: number;
    accessibility: number;
    bestPractices: number;
    seo: number;
  };
  opportunities: { title: string; description: string; savingsMs?: number }[];
};

export async function runPsi(url: string): Promise<PsiResult> {
  const params = new URLSearchParams({ url, strategy: "mobile" });
  ["performance", "accessibility", "best-practices", "seo"].forEach((c) =>
    params.append("category", c)
  );
  if (process.env.PSI_API_KEY) params.set("key", process.env.PSI_API_KEY);

  const res = await fetch(`${ENDPOINT}?${params}`, {
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const j: any = await res.json().catch(() => ({}));
    throw new Error(j.error?.message || `PSI failed (${res.status})`);
  }

  const data: any = await res.json();
  const lh = data.lighthouseResult;
  if (!lh) throw new Error("PSI returned no Lighthouse result");

  const score = (k: string) =>
    Math.round(((lh.categories?.[k]?.score as number) || 0) * 100);

  const opportunities = Object.values<any>(lh.audits || {})
    .filter(
      (a) =>
        a?.details?.type === "opportunity" &&
        a.score !== null &&
        a.score < 0.9
    )
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map((a) => ({
      title: a.title,
      description: (a.description || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"),
      savingsMs: a.details?.overallSavingsMs,
    }));

  return {
    url: lh.finalDisplayedUrl || lh.finalUrl || url,
    scores: {
      performance: score("performance"),
      accessibility: score("accessibility"),
      bestPractices: score("best-practices"),
      seo: score("seo"),
    },
    opportunities,
  };
}

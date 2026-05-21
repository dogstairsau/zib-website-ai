import Anthropic from "@anthropic-ai/sdk";

export const config = { runtime: "edge" };

type Body = { term?: string };
type Intent = "I" | "C" | "N" | "T";
type PromptItem = { prompt: string; intent: Intent };

const SYSTEM_PROMPT = `You analyse Google search suggestions and predict how the same users would phrase those questions to an AI chatbot (ChatGPT, Claude, Gemini).

Given a seed term and a list of raw Google autosuggest results, pick the 12 most useful and rewrite each as a natural AI-chatbot prompt — full sentences, conversational, the way a real person types into ChatGPT, not the shorthand they type into Google.

For each prompt, classify intent:
- I = Informational (just learning)
- C = Commercial (researching to buy or hire)
- N = Navigational (looking for a specific brand or site)
- T = Transactional (ready to act, sign up, purchase)

Return ONLY valid JSON. No markdown, no preamble. Exact shape:
{"prompts":[{"prompt":"...","intent":"I"}, ...]}`;

const QUESTION_PREFIXES = ["how", "what", "where", "can", "why", "who", "when", "which", "is", "are", "do", "does", "should"];

async function fetchAutosuggest(query: string): Promise<string[]> {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=au&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ZibPromptResearch/1.0)" },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    return Array.isArray(data) && Array.isArray((data as unknown[])[1]) ? ((data as unknown[])[1] as string[]) : [];
  } catch {
    return [];
  }
}

async function gatherSuggestions(term: string): Promise<string[]> {
  const queries = [
    term,
    ...QUESTION_PREFIXES.map((p) => `${p} ${term}`),
    `${term} vs`,
    `best ${term}`,
    `${term} cost`,
    `${term} near me`,
    `${term} reviews`,
  ];
  const results = await Promise.all(queries.map(fetchAutosuggest));
  const all = results.flat().map((s) => s.trim()).filter(Boolean);
  return [...new Set(all)].slice(0, 80);
}

function userPrompt(term: string, suggestions: string[]): string {
  return `Seed term: "${term}"
Locale: Australia
Google autosuggest results:
${suggestions.join("\n")}

Generate the 12 best AI-chatbot prompts with intent classifications.`;
}

function parsePrompts(text: string): PromptItem[] {
  try {
    const cleaned = text.replace(/^```json\s*|\s*```$/g, "").trim();
    const parsed = JSON.parse(cleaned) as { prompts?: PromptItem[] };
    const list = Array.isArray(parsed?.prompts) ? parsed.prompts : [];
    return list
      .filter((p) => p && typeof p.prompt === "string" && ["I", "C", "N", "T"].includes(p.intent))
      .slice(0, 15);
  } catch {
    return [];
  }
}

async function runClaude(term: string, suggestions: string[]): Promise<PromptItem[]> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt(term, suggestions) }],
  });
  const text = msg.content[0]?.type === "text" ? msg.content[0].text : "";
  return parsePrompts(text);
}

async function runOpenAI(term: string, suggestions: string[]): Promise<PromptItem[]> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt(term, suggestions) },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return parsePrompts(data.choices?.[0]?.message?.content ?? "");
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const term = body.term?.trim();
  if (!term || term.length < 2 || term.length > 80) {
    return new Response(JSON.stringify({ error: "term required (2–80 chars)" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const suggestions = await gatherSuggestions(term);
  if (suggestions.length === 0) {
    return new Response(JSON.stringify({ error: "No Google suggestions found for that term" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const [claudeResult, openaiResult] = await Promise.allSettled([
    runClaude(term, suggestions),
    runOpenAI(term, suggestions),
  ]);

  return new Response(
    JSON.stringify({
      term,
      suggestionCount: suggestions.length,
      suggestions,
      claude: claudeResult.status === "fulfilled" ? claudeResult.value : [],
      openai: openaiResult.status === "fulfilled" ? openaiResult.value : [],
      claudeError: claudeResult.status === "rejected" ? String(claudeResult.reason) : null,
      openaiError: openaiResult.status === "rejected" ? String(openaiResult.reason) : null,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}

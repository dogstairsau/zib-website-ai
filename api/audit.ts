import Anthropic from "@anthropic-ai/sdk";
import { fetchSiteContent, formatForPrompt, normaliseUrl, isValidEmail } from "../lib/site";
import { runPsi } from "../lib/psi";
import { captureLead } from "../lib/hubspot";
import { AUDIT_SYSTEM_PROMPT, auditUserPrompt } from "../lib/prompts/audit";

export const config = { runtime: "edge" };

type Body = {
  url?: string;
  email?: string;
  firstname?: string;
  company?: string;
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const url = normaliseUrl(body.url || "");
  const email = (body.email || "").trim();
  if (!url) return json({ error: "Enter a valid website URL." }, 400);
  if (!isValidEmail(email)) return json({ error: "Enter a valid work email." }, 400);

  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: "Server not configured (ANTHROPIC_API_KEY missing)." }, 500);
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        send("status", { phase: "fetch", message: "Reading the site…" });
        const site = await fetchSiteContent(url);

        send("status", { phase: "psi", message: "Running performance audit…" });
        // Run PSI in parallel with the strategist read
        const psiPromise = runPsi(url).catch((e) => {
          console.warn("[psi]", e.message);
          return null;
        });

        send("status", { phase: "think", message: "Senior strategist read…" });

        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const messageStream = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 1500,
          system: AUDIT_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: auditUserPrompt(url, formatForPrompt(site)),
            },
          ],
        });

        for await (const event of messageStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            send("chunk", { text: event.delta.text });
          }
        }

        const psi = await psiPromise;
        if (psi) send("psi", psi);

        // Capture lead AFTER analysis completes (so failures don't block UX)
        captureLead({
          email,
          firstname: body.firstname?.trim() || "",
          company: body.company?.trim() || "",
          website: url,
          source: "Homepage audit",
        }).catch((e) => console.warn("[lead]", e.message));

        send("done", { url: site.url });
      } catch (err: any) {
        send("error", { message: err?.message || "Audit failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

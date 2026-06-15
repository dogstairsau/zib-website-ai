import Anthropic from "@anthropic-ai/sdk";
import { fetchSiteContent, normaliseUrl, type SiteContent } from "../lib/site";
import { guard } from "../lib/rateLimit";
import { isSafeFetchUrl } from "../lib/safeUrl";

export const config = { runtime: "edge" };

type Body = { url?: string };

type Blog = {
  title: string;
  metaDescription: string;
  targetKeyword: string;
  body: string;
};

async function generateBlogPost(site: SiteContent, anthropic: Anthropic): Promise<Blog | null> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: `You are a senior content strategist at Zib Digital. A prospect just submitted their URL for an instant audit — write a sample SEO-optimised blog post that demonstrates what we'd produce for them. This appears alongside a creative mockup, proving we don't just talk strategy, we ship assets.

Output ONLY valid JSON, no markdown fences:

{
  "title": "Article title — 60 chars max. SEO-aware. Specific to brand's category. Title Case.",
  "metaDescription": "140-160 chars. Compelling. Includes target keyword naturally. Sentence case.",
  "targetKeyword": "the primary keyword this post is optimised for (2-4 words)",
  "body": "Markdown body, 500-650 words. Use ## for section headings (3-4 sections). Open with a strong hook, deliver real insight tied to the brand's commercial reality, close with a soft CTA paragraph. Use Australian English (optimisation, organisation)."
}

Voice rules, non-negotiable:
- Confident, commercial. No agency jargon ("unlock", "elevate", "leverage", "synergy", "thrilled" are banned).
- Commercial-first language: revenue, leads, conversion, ROI, customers, pipeline. Not "engagement", "presence", "awareness".
- Real value, never a thin SEO shell padded with filler. The post should be genuinely useful.
- Specific to the brand's actual offering. Don't write generic industry copy.
- Reference signals from the page when natural (their service, audience, location).
- NEVER use em-dashes (—). They read as AI-generated. Use commas, periods, colons, or parentheses instead. This rule is absolute and applies to every field in the JSON.`,
    messages: [
      {
        role: "user",
        content: `Write the sample blog post for this brand:

URL: ${site.url}
Title: ${site.title}
Description: ${site.description}
H1: ${site.h1}
H2s: ${site.h2s.slice(0, 8).join(" | ")}
Body excerpt: ${site.bodyText.slice(0, 2500)}

Return only the JSON object.`,
      },
    ],
  });

  const text = message.content?.[0]?.type === "text" ? message.content[0].text : "";
  try {
    const cleaned = text.replace(/^```json\s*|\s*```$/g, "").trim();
    const blog = JSON.parse(cleaned) as Blog;
    // Belt-and-braces: scrub em-dashes if the model slipped any in.
    const scrub = (s: string) => (s || "").replace(/\s*—\s*/g, ", ").replace(/–/g, "-");
    blog.title = scrub(blog.title);
    blog.metaDescription = scrub(blog.metaDescription);
    blog.targetKeyword = scrub(blog.targetKeyword);
    blog.body = scrub(blog.body);
    return blog;
  } catch {
    console.warn("[blog] failed to parse JSON");
    return null;
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const url = normaliseUrl(body.url || "");
  if (!url) return json({ error: "Missing URL." }, 400);
  if (!isSafeFetchUrl(url).ok) return json({ error: "That URL can't be processed." }, 400);
  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: "Server not configured (ANTHROPIC_API_KEY missing)." }, 500);
  }

  // Rate limit: 3 blog generations per 10 minutes per IP (no-op until KV is set up)
  const blocked = await guard(req, "blog");
  if (blocked) return blocked;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        send("status", { message: "Reading the site…" });
        const site = await fetchSiteContent(url);
        send("status", { message: "Drafting your sample blog post…" });

        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const blog = await generateBlogPost(site, anthropic);

        if (!blog) throw new Error("Blog generation failed.");
        send("blog", blog);
        send("done", {});
      } catch (err: any) {
        send("error", { message: err?.message || "Blog generation failed." });
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

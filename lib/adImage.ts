/**
 * Shared branded image generation for the ad labs (Meta + Google).
 *
 * When brand reference images are available, generation goes through
 * OpenAI's images/edits endpoint with input_fidelity high so the output
 * carries the client's real product, packaging and colour world instead of
 * generic AI stock. 429s and transient upstream errors retry with backoff —
 * they are the main reason creatives silently fail to load.
 */

import type { FetchedImage } from "./brandAssetFetch";

export type BrandReference = { image: FetchedImage; kind: "logo" | "site" };

export type BrandedImageOpts = {
  quality: string;
  references: BrandReference[];
  colors: string[];
};

export async function generateBrandedImage(
  brand: string,
  imagePrompt: string,
  size: string,
  apiKey: string,
  opts: BrandedImageOpts,
): Promise<string | null> {
  const { quality, references, colors } = opts;
  const hasLogo = references.some((r) => r.kind === "logo");

  const promptParts = [
    `Editorial photograph for ${brand}.`,
    imagePrompt,
  ];
  if (colors.length) {
    promptParts.push(
      `Colour world: anchor the scene in the brand's palette (${colors.join(", ")}) through props, surfaces, wardrobe and lighting — naturally, not as flat colour fills.`,
    );
  }
  if (references.length) {
    promptParts.push(
      `The attached reference image(s) show the brand's real ${hasLogo ? "logo and " : ""}visual identity. Match their product, packaging, materials and colour treatment so the photo unmistakably belongs to this brand.` +
        (hasLogo
          ? ` The logo may appear naturally in-scene (on product, packaging or signage), small and photorealistic — reproduce it faithfully, never distorted.`
          : ""),
    );
  }
  promptParts.push(
    `Style: editorial, magazine-quality, restrained. NOT stock-photo. No overlaid text, no typography, no watermarks${hasLogo ? " (the brand's own logo on product or signage is the only exception)" : ", no logos"}. Pure photographic composition.`,
  );
  const prompt = promptParts.join("\n\n");

  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  const doFetch = (): Promise<Response> => {
    if (references.length) {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", prompt);
      form.append("size", size);
      form.append("quality", quality);
      form.append("input_fidelity", "high");
      form.append("n", "1");
      for (const ref of references) {
        const ext = ref.image.mime === "image/png" ? "png" : ref.image.mime === "image/webp" ? "webp" : "jpg";
        form.append(
          "image[]",
          new Blob([ref.image.bytes], { type: ref.image.mime }),
          `${ref.kind}.${ext}`,
        );
      }
      return fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
    }
    return fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, prompt, size, quality, n: 1 }),
      signal: AbortSignal.timeout(120_000),
    });
  };

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2_500 * attempt + Math.random() * 1_500));
    let res: Response;
    try {
      res = await doFetch();
    } catch (e: any) {
      lastErr = new Error(e?.name === "TimeoutError" ? "OpenAI request timed out" : e?.message);
      continue; // network error / timeout — retryable
    }
    if (res.ok) {
      const data = await res.json();
      const b64 = data.data?.[0]?.b64_json;
      if (!b64) throw new Error("No image data");
      return `data:image/png;base64,${b64}`;
    }
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message || `OpenAI ${res.status}`;
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(msg);
      continue; // retryable
    }
    throw new Error(msg); // 4xx — let the caller decide on a fallback
  }
  throw lastErr || new Error("Image generation failed");
}

/**
 * Branded generation with a plain-generation fallback: if the referenced
 * edits call is rejected (bad brand image, unsupported param), fall back
 * to text-only generation rather than shipping no visual at all.
 */
export async function generateBrandedImageWithFallback(
  brand: string,
  imagePrompt: string,
  size: string,
  apiKey: string,
  opts: BrandedImageOpts,
  label: string,
): Promise<string | null> {
  try {
    return await generateBrandedImage(brand, imagePrompt, size, apiKey, opts);
  } catch (e: any) {
    if (!opts.references.length) throw e;
    console.warn(`[${label}] edit with references failed, retrying plain:`, e?.message);
    return generateBrandedImage(brand, imagePrompt, size, apiKey, { ...opts, references: [] });
  }
}

/** Run jobs with bounded concurrency, in order. */
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

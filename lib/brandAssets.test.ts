import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractBrandAssetRefs,
  extractStylesheetUrls,
  isUsableBrandColor,
  rankCssColors,
} from "./brandAssets.ts";

const BASE = "https://example.com.au/";

test("finds logo from JSON-LD Organization", () => {
  const html = `<script type="application/ld+json">{"@type":"Organization","logo":"https://example.com.au/img/logo.png"}</script>`;
  assert.equal(extractBrandAssetRefs(html, BASE).logoUrl, "https://example.com.au/img/logo.png");
});

test("finds logo from nested JSON-LD ImageObject", () => {
  const html = `<script type="application/ld+json">{"logo":{"@type":"ImageObject","url":"/logo.webp"}}</script>`;
  assert.equal(extractBrandAssetRefs(html, BASE).logoUrl, "https://example.com.au/logo.webp");
});

test("finds header img with logo in class, resolves relative URL", () => {
  const html = `<header><img class="site-logo" src="/assets/brand.png" alt="Acme"></header>`;
  assert.equal(extractBrandAssetRefs(html, BASE).logoUrl, "https://example.com.au/assets/brand.png");
});

test("finds logo via alt text and lazy data-src", () => {
  const html = `<img data-src="/lazy-brand.png" alt="Acme logo">`;
  assert.equal(extractBrandAssetRefs(html, BASE).logoUrl, "https://example.com.au/lazy-brand.png");
});

test("falls back to apple-touch-icon, skips .ico", () => {
  const html = `<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" sizes="180x180" href="/apple-icon.png">`;
  assert.equal(extractBrandAssetRefs(html, BASE).logoUrl, "https://example.com.au/apple-icon.png");
});

test("extracts og:image", () => {
  const html = `<meta property="og:image" content="https://cdn.example.com/hero.jpg" />`;
  assert.equal(extractBrandAssetRefs(html, BASE).ogImageUrl, "https://cdn.example.com/hero.jpg");
});

test("ignores data: URIs and non-http schemes", () => {
  const html = `<img class="logo" src="data:image/png;base64,xxx">`;
  assert.equal(extractBrandAssetRefs(html, BASE).logoUrl, null);
});

test("theme-color ranks first among colours", () => {
  const html = `
    <meta name="theme-color" content="#FF6200">
    <style>.a{color:#ff6200}.b{background:#1f3a47}.b:hover{background:#1f3a47}</style>`;
  const { colors } = extractBrandAssetRefs(html, BASE);
  assert.equal(colors[0], "#ff6200");
  assert.ok(colors.includes("#1f3a47"));
});

test("filters whites, blacks and greys out of colours", () => {
  const html = `<style>.x{color:#ffffff;background:#000;border-color:#888888;outline-color:#b83b00}</style>`;
  assert.deepEqual(extractBrandAssetRefs(html, BASE).colors, ["#b83b00"]);
});

test("returns at most 3 colours", () => {
  const html = `<style>.a{color:#ff0000}.b{color:#00aa00}.c{color:#0000ff}.d{color:#aa00aa}</style>`;
  assert.equal(extractBrandAssetRefs(html, BASE).colors.length, 3);
});

test("isUsableBrandColor expands 3-digit hex", () => {
  assert.equal(isUsableBrandColor("#f60"), true);
  assert.equal(isUsableBrandColor("#fff"), false);
  assert.equal(isUsableBrandColor("#000"), false);
});

test("extractStylesheetUrls resolves relative hrefs, caps at max", () => {
  const html = `
    <link rel="stylesheet" href="/css/main.css">
    <link rel="preload" href="/font.woff2">
    <link rel="stylesheet" href="https://cdn.example.com/theme.css">
    <link rel="stylesheet" href="/css/extra.css">`;
  assert.deepEqual(extractStylesheetUrls(html, BASE), [
    "https://example.com.au/css/main.css",
    "https://cdn.example.com/theme.css",
  ]);
});

test("rankCssColors skips WordPress default block palette", () => {
  const css = `--wp--preset--color--vivid-cyan-blue:#0693e3;--wp--preset--color--vivid-green-cyan:#00d084;.brand{color:#00d5d5}`;
  assert.deepEqual(rankCssColors(css), ["#00d5d5"]);
});

test("rankCssColors orders by frequency and filters greys", () => {
  const css = `.a{color:#ff6200}.b{color:#ff6200}.c{color:#1f3a47}.d{color:#eeeeee}`;
  assert.deepEqual(rankCssColors(css), ["#ff6200", "#1f3a47"]);
});

test("empty page yields empty refs", () => {
  const refs = extractBrandAssetRefs("<html><body>hi</body></html>", BASE);
  assert.deepEqual(refs, { logoUrl: null, ogImageUrl: null, colors: [] });
});

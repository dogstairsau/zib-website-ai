import { test } from "node:test";
import assert from "node:assert/strict";
import { matchRecipient, type Recipient } from "./proposalRecipients.ts";

const SARAH: Recipient = {
  token: "a7f3c9d1",
  name: "Sarah",
  company: "Boothalicious",
  email: "sarah@example.com",
  slugs: ["boothalicious-seo-audit"],
};

const MULTI: Recipient = {
  token: "b2e8f401",
  name: "Dev",
  company: "Acme",
  slugs: ["proposal-one", "proposal-two"],
};

const LIST = [SARAH, MULTI];

test("matches a valid token on its own page", () => {
  assert.equal(matchRecipient(LIST, "a7f3c9d1", "boothalicious-seo-audit"), SARAH);
});

test("is case-insensitive and tolerates surrounding whitespace", () => {
  assert.equal(matchRecipient(LIST, "A7F3C9D1", "boothalicious-seo-audit"), SARAH);
  assert.equal(matchRecipient(LIST, "  a7f3c9d1 ", "boothalicious-seo-audit"), SARAH);
});

test("honours every slug a token is issued for", () => {
  assert.equal(matchRecipient(LIST, "b2e8f401", "proposal-one"), MULTI);
  assert.equal(matchRecipient(LIST, "b2e8f401", "proposal-two"), MULTI);
});

test("refuses a valid token on a page it was not issued for", () => {
  // The point of the slug binding: a token leaked from one proposal must not
  // start attributing reads of a different one.
  assert.equal(matchRecipient(LIST, "a7f3c9d1", "proposal-one"), null);
});

test("rejects unknown tokens", () => {
  assert.equal(matchRecipient(LIST, "deadbeef", "boothalicious-seo-audit"), null);
});

test("rejects malformed tokens without consulting the list", () => {
  const bad: unknown[] = [
    "",                    // empty
    "abc",                 // under the 6-char minimum
    "a".repeat(33),        // over the 32-char maximum
    "a7f3-c9d1",           // punctuation
    "a7f3 c9d1",           // internal space
    "../../etc/passwd",    // traversal
    "a7f3c9d1'; DROP--",   // injection shape
    null,
    undefined,
    42,
    { token: "a7f3c9d1" },
    ["a7f3c9d1"],
  ];
  for (const t of bad) {
    assert.equal(matchRecipient(LIST, t, "boothalicious-seo-audit"), null, `should reject ${JSON.stringify(t)}`);
  }
});

test("rejects a missing or non-string slug", () => {
  assert.equal(matchRecipient(LIST, "a7f3c9d1", ""), null);
  assert.equal(matchRecipient(LIST, "a7f3c9d1", undefined), null);
  assert.equal(matchRecipient(LIST, "a7f3c9d1", 7), null);
});

test("an empty recipient list matches nothing", () => {
  // The shipped default: tracking is inert until someone is added.
  assert.equal(matchRecipient([], "a7f3c9d1", "boothalicious-seo-audit"), null);
});

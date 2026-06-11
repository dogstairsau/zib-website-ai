import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafeFetchUrl } from "./safeUrl.ts";

// [url, expectedAllowed]
const cases: [string, boolean][] = [
  // Public targets — allowed
  ["https://zibdigital.com.au", true],
  ["http://example.com/path?q=1", true],
  ["https://1.2.3.4", true], // public IP literal
  // SSRF targets — blocked
  ["http://localhost", false],
  ["http://127.0.0.1", false],
  ["http://127.0.0.1:8080/admin", false],
  ["http://169.254.169.254/latest/meta-data/", false], // cloud metadata
  ["http://10.0.0.5", false],
  ["http://192.168.1.1", false],
  ["http://172.16.0.1", false],
  ["http://100.64.0.1", false], // CGNAT
  ["http://[::1]/", false], // IPv6 loopback
  ["http://app.internal", false],
  ["http://intranet", false], // single-label host
  ["ftp://example.com", false], // non-http(s) scheme
  ["https://user:pass@example.com", false], // embedded credentials
  ["file:///etc/passwd", false],
  ["not a url", false],
];

for (const [url, expected] of cases) {
  test(`${expected ? "allows" : "blocks"} ${url}`, () => {
    assert.equal(isSafeFetchUrl(url).ok, expected);
  });
}

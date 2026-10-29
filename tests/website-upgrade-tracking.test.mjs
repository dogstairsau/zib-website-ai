import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../assets/website-upgrade.js', import.meta.url), 'utf8');
function setup({ consent = true, ok = true, valid = true } = {}) {
  const calls = [], handlers = {}, formHandlers = {};
  const form = { reportValidity: () => valid, addEventListener: (n, f) => formHandlers[n] = f, querySelectorAll: () => [] };
  const button = {}, status = { focus() {} };
  const context = {
    window: { gtag: (...args) => calls.push(args), zibLead() {}, zibClickIds: () => ({}) },
    document: { getElementById: id => ({ 'upgrade-form': form, 'submit-application': button, 'form-status': status, website: { focus() {} } })[id], querySelectorAll: () => [], addEventListener: (n, f) => handlers[n] = f },
    localStorage: { getItem: () => JSON.stringify({ v: 1, marketing: consent }) },
    crypto: { randomUUID: () => 'test-submission-123456789' },
    Date, URL, FormData: class { *[Symbol.iterator]() { yield ['website', 'example.com']; } },
    fetch: async () => ({ ok, json: async () => ({ ok }) }),
  };
  vm.runInNewContext(source, context);
  return { calls, button, status, submit: () => formHandlers.submit({ preventDefault() {} }), consent: marketing => handlers['zib:consent']({ detail: { v: 1, marketing } }) };
}
const events = s => s.calls.filter(c => c[0] === 'event' && c[1] === 'conversion');
test('only accepted applications send one conversion with a stable deduplication ID', async () => {
  const s = setup(); assert.equal(events(s).length, 0);
  await s.submit(); await s.submit(); s.consent(true); s.consent(true);
  assert.equal(events(s).length, 1);
  assert.equal(events(s)[0][2].send_to, 'AW-762912823/zcg6CODO2a0dELfA5OsC');
  assert.equal(events(s)[0][2].transaction_id, 'test-submission-123456789');
});
test('failed and invalid submissions never convert', async () => {
  for (const opts of [{ ok: false }, { valid: false }]) { const s = setup(opts); await s.submit(); assert.equal(events(s).length, 0); }
});
test('marketing denial blocks Ads; later consent sends accepted application once', async () => {
  const s = setup({ consent: false }); await s.submit(); s.consent(false);
  assert.equal(s.calls.length, 0); s.consent(true); s.consent(true);
  assert.equal(events(s).length, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import { LEGAL, SUPPORT_EMAIL, legalHtml, pricingHtml } from "../src/server/legal.js";

// Payment providers review these pages: price, renewal, refunds and a contact must be visible.
test("pricing and legal pages show price, refund rules and a contact", () => {
  const pricing = pricingHtml("https://example.com");
  assert.match(pricing, /\$19/);
  assert.match(pricing, /renews monthly/);
  assert.ok(pricing.includes(SUPPORT_EMAIL));
  for (const path of Object.keys(LEGAL) as (keyof typeof LEGAL)[]) {
    const html = legalHtml("https://example.com", path);
    assert.ok(html.includes(SUPPORT_EMAIL), path);
    assert.ok(html.includes(`href="https://example.com${path}"`), path);
    assert.ok(!html.includes("undefined"), path);
  }
  assert.match(legalHtml("https://example.com", "/refund"), /14 days/);
});

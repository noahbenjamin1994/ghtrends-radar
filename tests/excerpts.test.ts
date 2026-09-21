import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceExcerpt } from "../src/core/excerpts.js";
import { modelSources } from "../src/providers/research.js";
import { pageText } from "../src/providers/documents.js";

test("late original facts and their conditions survive collection and model passage selection", () => {
  const condition = "Orion export costs $12 per month, billed annually; the Starter plan excludes team sharing.";
  const body = "Welcome to Orion.\n" + "General company background and marketing material.\n".repeat(180) + "\nExport pricing\n" + condition + "\nPrices exclude tax. No enterprise features are included.\n";
  const page = pageText(`<main>${body}</main>`, "Orion export pricing annually");
  assert.ok(page.text.length <= 6000);
  assert.ok(page.excerptTruncated);
  assert.ok(page.text.includes(condition));
  const source = { id: "WP1", label: "Orion", kind: "search" as const, documentType: "page" as const, url: "https://orion.example/pricing", excerpt: page.text };
  const before = JSON.stringify(source);
  const compact = modelSources([source], "Orion export pricing annually")[0]!;
  assert.ok(compact.excerpt!.length <= 2600);
  assert.ok(compact.excerpt!.includes(condition));
  for (const span of compact.excerpt!.split("\n\n[…]\n\n")) assert.ok(body.includes(span));
  assert.equal(JSON.stringify(source), before);
});

test("Chinese query passages retain late use conditions instead of the page introduction only", () => {
  const fact = "开心锤锤周边活动须先获得授权；当前页面没有公布授权价格。";
  const original = "介绍与一般说明。\n".repeat(1400) + fact;
  const result = evidenceExcerpt(original, 2600, "开心锤锤 周边 活动 授权 价格");
  assert.ok(result.includes(fact));
  assert.ok(result.length <= 2600);
  for (const span of result.split("\n\n[…]\n\n")) assert.ok(original.includes(span));
  assert.equal(evidenceExcerpt("short source", 2600, "price"), "short source");
});

test("an omission separator cannot become a fabricated continuous quotation", async () => {
  const { validQuote, sourceQuoteSchema } = await import("../src/core/landscape.js");
  const source = { id: "WP1", label: "Pricing", url: "https://orion.example", excerpt: "The plan costs $12.\n\n[…]\n\nEnterprise is negotiated separately." };
  const joined = { id: "WP1", quote: "The plan costs $12. […] Enterprise is negotiated separately." };
  assert.equal(validQuote(joined, [source]), false);
  assert.equal(sourceQuoteSchema.safeParse(joined.quote).success, false);
  assert.equal(validQuote({ id: "WP1", quote: "Enterprise is negotiated separately." }, [source]), true);
});

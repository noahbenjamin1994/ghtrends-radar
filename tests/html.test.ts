import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderDocument } from "../src/server/html.js";
import type { Market } from "../src/core/types.js";

const template = readFileSync(
  new URL("../index.html", import.meta.url),
  "utf8",
);
const markets: Market[] = JSON.parse(
  readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
);
const market = markets.find((m) => m.topic.slug === "mcp-servers")!;
const options = {
  base: "https://radar.ghtrends.dev",
  path: `/report/${market.id}`,
  geo: "",
  market,
  markets,
  status: 200,
};

test("a shared report has one specific preview and readable source evidence without JavaScript", () => {
  const html = renderDocument(template, options);
  assert.equal((html.match(/property="og:title"/g) || []).length, 1);
  assert.equal((html.match(/property="og:description"/g) || []).length, 1);
  assert.equal((html.match(/name="description"/g) || []).length, 1);
  assert.match(html, /og:title" content="MCP servers: Established red ocean/);
  assert.match(html, new RegExp(`/api/cards/${market.id}\\.png`));
  const body = html.split("<body>")[1]!;
  for (const text of [
    market.headline,
    market.demand.keyword,
    market.supply.repositories[0]!.name,
    market.asOf.slice(0, 10),
    "Limits of this result",
    "Permanent report",
  ]) {
    assert.ok(body.includes(text), text);
  }
  assert.ok(!body.includes('<div id="root"></div>'));
  const schema = JSON.parse(
    html.match(/<script type="application\/ld\+json">([^]*?)<\/script>/)![1]!,
  );
  assert.equal(schema.dateModified, market.asOf);
  assert.equal(schema.url, options.base + options.path);
});

test("regional evidence keeps a distinct canonical while reports keep their permanent identity", () => {
  const regional = { ...market, geo: "US" };
  const html = renderDocument(template, {
    ...options,
    path: "/market/mcp-servers",
    geo: "US",
    market: regional,
  });
  assert.match(
    html,
    /rel="canonical" href="https:\/\/radar.ghtrends.dev\/market\/mcp-servers\?geo=US"/,
  );
  const report = renderDocument(template, {
    ...options,
    geo: "US",
    market: regional,
  });
  assert.ok(!report.includes(`href="${options.base}${options.path}?geo=US"`));
});

test("the initial homepage links to every curated category and missing pages cannot be indexed", () => {
  const html = renderDocument(template, {
    ...options,
    path: "/",
    market: null,
  });
  for (const m of markets)
    assert.ok(html.includes(`href="/market/${m.topic.slug}"`));
  assert.match(
    html,
    /og:image" content="https:\/\/radar.ghtrends.dev\/social-card.png"/,
  );
  const missing = renderDocument(template, {
    ...options,
    market: null,
    path: "/missing",
    status: 404,
  });
  assert.match(missing, /<h1>Page not found/);
  assert.match(missing, /name="robots" content="noindex,follow"/);
});

test("report text and source links cannot inject markup or executable URLs", () => {
  const hostile = structuredClone(market);
  hostile.topic.name = '</script><img src=x onerror="alert(1)">';
  hostile.supply.sourceUrl = "javascript:alert(1)";
  const html = renderDocument(template, { ...options, market: hostile });
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes("&lt;img src=x"));
  const schema = JSON.parse(
    html.match(/<script type="application\/ld\+json">([^]*?)<\/script>/)![1]!,
  );
  assert.equal(
    schema.name,
    `${hostile.topic.name}: ${hostile.headline} · ghtrends`,
  );
});

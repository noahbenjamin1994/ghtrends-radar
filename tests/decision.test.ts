import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  userEvidence,
  DECISION_PROMPT,
  effectiveDecision,
  finalizeDecision,
  legacyReport,
  parseDecisionDraft,
  verdictTitle,
} from "../src/core/decision.js";
import { parseReport, reportCitations } from "../src/core/report-contract.js";
import {
  finalizeReport,
  forumWords,
  onTopic,
} from "../src/providers/report.js";
import { scopedSources, searchSources } from "../src/providers/search.js";
import { sentences } from "../src/server/revisions.js";
import type { Market, ResearchSource } from "../src/core/types.js";

const t = (en: string, zh: string) => ({ en, zh });
const text = t("Short English sentence.", "一句简短的中文。");
const market = (): Market =>
  structuredClone(
    JSON.parse(
      readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
    )[0],
  );
const sources: ResearchSource[] = [
  {
    id: "S1",
    label: "Google Trends",
    url: "https://trends.google.com/",
    excerpt: '{"keyword":"sample","trend":"rising"}',
  },
  {
    id: "S2",
    label: "Ask HN: logged-in content",
    url: "https://news.ycombinator.com/item?id=1",
    documentType: "hn-comment",
    excerpt:
      "We keep getting banned every few days and have no way to read logged-in posts.",
  },
  {
    id: "S3",
    label: "Acme pricing",
    url: "https://acme.example/pricing",
    documentType: "page",
    searchIntent: "competition",
    excerpt: "Starter is $49 per month and does not include logged-in content.",
  },
  {
    id: "S4",
    label: "Vendor blog",
    url: "https://vendor.example/blog",
    documentType: "page",
    searchIntent: "competition",
    excerpt: "Teams struggle with scraping at scale, says our marketing team.",
  },
];
const citations = reportCitations(sources);
const draft = () => ({
  verdict: { kind: "reframe", reason: text },
  pains: [
    { title: text, workaround: text, quotes: ["S2Q1"] },
    // Vendor copy is not a user's own words.
    { title: text, workaround: null, quotes: ["S4Q1"] },
  ],
  commercial: [
    {
      name: "Acme",
      audience: text,
      pricing: text,
      gap: text,
      evidence: ["S3Q1"],
    },
  ],
  openSource: [
    { name: "ghost/not-collected", capability: text, evidence: ["S3Q1"] },
  ],
  directions: [
    {
      title: text,
      audience: text,
      pain: "P1",
      supply: ["C1"],
      whyOpen: text,
      uncertainty: text,
    },
    // Points at the vendor-only pain, which the pain gate removes.
    {
      title: text,
      audience: text,
      pain: "P2",
      supply: ["C1"],
      whyOpen: text,
      uncertainty: text,
    },
    // Points at supply that was never listed.
    {
      title: text,
      audience: text,
      pain: "P1",
      supply: ["C9"],
      whyOpen: text,
      uncertainty: text,
    },
  ],
  nextStep: { who: text, ask: text, success: text, fail: text },
  unverified: [text],
});
const withPages = () => {
  const m = market();
  m.web = {
    provider: "multi-search",
    region: "US",
    language: "en",
    fetchedAt: new Date().toISOString(),
    state: "ready",
    queries: [],
  };
  m.documents = { version: "1", sources: [], reads: [] };
  return m;
};

test("the prompt derives directions from pains minus supply and keeps the guard rails", () => {
  for (const rule of [
    /Do not invent three ideas first/,
    /Preserve negation/,
    /never by shared keywords/,
    /Never write, translate or paraphrase a quote/,
    /"insufficient" is only for zero pains or zero supply rows/,
    /Do not say "interview users" in general/,
  ])
    assert.match(DECISION_PROMPT, rule);
});

test("pain, slice and supply gates decide what may be shown", () => {
  const d = finalizeDecision(
    parseDecisionDraft(draft(), citations),
    withPages(),
    sources,
  );
  assert.deepEqual(
    d.pains.map((p) => p.id),
    ["P1"],
  );
  assert.equal(d.pains[0]!.quotes[0]!.quote, sources[1]!.excerpt);
  assert.deepEqual(d.openSource, [], "uncollected repositories are dropped");
  assert.deepEqual(
    d.directions.map((x) => x.id),
    ["D1"],
  );
  assert.equal(d.verdict.kind, "reframe");
  assert.equal(d.coverage.supply, "full");
  assert.equal(d.directions[0]!.tentative, undefined);
  assert.deepEqual(d.nextStep?.where, [
    { label: sources[1]!.label, url: sources[1]!.url },
  ]);
  assert.match(d.timing.summary.zh, /近 8 周比前 8 周|没采到/);
});

test("no first-hand pain means no directions, no next step and an honest verdict", () => {
  const raw = draft();
  raw.pains = [{ title: text, workaround: null, quotes: ["S4Q1"] }];
  const d = finalizeDecision(
    parseDecisionDraft(raw, citations),
    withPages(),
    sources,
  );
  assert.equal(d.verdict.kind, "insufficient");
  assert.equal(d.verdict.forced, true);
  assert.match(d.verdict.reason.zh, /不代表需求不存在/);
  assert.deepEqual(d.directions, []);
  assert.equal(d.nextStep, null);
});

test("a go verdict without any surviving direction is not delivered as go", () => {
  const raw = draft();
  raw.verdict.kind = "go";
  raw.directions = raw.directions.slice(2);
  const d = finalizeDecision(
    parseDecisionDraft(raw, citations),
    withPages(),
    sources,
  );
  assert.equal(d.verdict.kind, "insufficient");
  assert.equal(d.nextStep, null);
});

test("failed collection is reported as a gap and makes directions tentative, never zero supply", () => {
  const m = withPages();
  m.web!.queries = [
    {
      query: "sample alternatives pricing",
      intent: "competition",
      state: "failed",
      error: "search_timeout",
      results: [],
    },
  ];
  m.documents!.reads = [
    {
      url: "https://www.reddit.com/r/sample",
      status: "access",
      observedAt: new Date().toISOString(),
    },
  ];
  const d = finalizeDecision(
    parseDecisionDraft(draft(), citations),
    m,
    sources,
  );
  assert.equal(d.coverage.supply, "partial");
  assert.equal(d.directions[0]!.tentative, true);
  assert.deepEqual(
    d.coverage.gaps.map((g) => [g.lane, g.label, g.reason]),
    [
      ["supply", "sample alternatives pricing", "timeout"],
      ["supply", "reddit.com", "unread"],
    ],
  );
});

test("invalid entries are dropped whole, unknown citations reject the draft", () => {
  const raw: any = draft();
  raw.commercial.push({ name: "Broken", audience: { en: "", zh: "" } });
  raw.nextStep = { who: text };
  let incomplete: string[] = [];
  const parsed = parseDecisionDraft(raw, citations, (s) => (incomplete = s));
  assert.equal(parsed.commercial.length, 1);
  assert.equal(parsed.nextStep, null);
  assert.deepEqual(incomplete, ["commercial", "nextStep"]);
  raw.pains[0].quotes = ["S99Q1"];
  assert.throws(() => parseDecisionDraft(raw, citations), /citation ID/);
  assert.throws(() =>
    parseDecisionDraft({ ...draft(), verdict: null }, citations),
  );
});

test("the previous report shape is derived and passes its own citation check", () => {
  const m = withPages();
  const d = finalizeDecision(
    parseDecisionDraft(draft(), citations),
    m,
    sources,
  );
  const legacy = parseReport(
    finalizeReport(legacyReport(d), m, sources),
    sources,
  );
  assert.equal(legacy.headline.zh, "细分机会");
  assert.equal(legacy.directions.length, 1);
  assert.equal(legacy.userNeeds.status, "observed");
  assert.match(legacy.commercialSupply.summary.en, /^Acme:/);
});

test("dismissing the last quote of a pain collapses what depends on it and can be undone", () => {
  const d = finalizeDecision(
    parseDecisionDraft(draft(), citations),
    withPages(),
    sources,
  );
  const untouched = effectiveDecision(d);
  assert.deepEqual(untouched.invalidated, []);
  assert.equal(untouched.revised, false);
  const after = effectiveDecision(d, { dismissed: ["P1:S2Q1"], stale: true });
  assert.deepEqual(after.emptied, ["P1"]);
  assert.deepEqual(after.invalidated, ["D1"]);
  assert.equal(after.nextStep, null);
  assert.equal(after.stale, true);
  assert.equal(after.pains[0]!.quotes.length, 1, "kept so it can be restored");
  assert.ok(d.nextStep, "the delivered report is never mutated");
});

test("a forum snippet and a forum comment count as a user's own words", () => {
  assert.equal(
    userEvidence({
      label: "thread",
      url: "https://www.reddit.com/r/x/comments/1",
      kind: "search",
      documentType: "forum-snippet",
    }),
    true,
  );
  assert.equal(
    userEvidence({
      label: "vendor",
      url: "https://vendor.example/blog",
      kind: "search",
      searchIntent: "demand",
    }),
    false,
  );
});

test("sections nested inside verdict by a misplaced brace are still read", () => {
  const draft = parseDecisionDraft(
    {
      verdict: {
        kind: "insufficient",
        reason: { en: "Not enough to judge.", zh: "证据不够判断。" },
        pains: [],
        commercial: [
          {
            name: "Acme",
            audience: { en: "Small teams.", zh: "小团队。" },
            evidence: ["S1Q1"],
          },
        ],
        openSource: [],
        directions: [],
        nextStep: null,
        unverified: [{ en: "Whether anyone pays.", zh: "有没有人付钱。" }],
      },
    },
    { S1Q1: { id: "S1", quote: "Acme serves small teams." } },
  );
  assert.equal(draft.commercial[0]!.name, "Acme");
  assert.equal(draft.unverified[0]!.zh, "有没有人付钱。");
});

test("a red ocean says which kind, a withheld verdict says what is missing, and user groups stand on real pains", () => {
  const raw: any = draft();
  raw.verdict = { kind: "stop", cause: "unsolvable", reason: text };
  raw.users = [
    { who: text, scenario: text, pains: ["P1", "P2"] },
    // P2 rests on vendor copy and does not survive the pain gate.
    { who: text, scenario: text, pains: ["P2"] },
    { who: text, pains: ["P1"] },
  ];
  const d = finalizeDecision(
    parseDecisionDraft(raw, citations),
    withPages(),
    sources,
  );
  assert.equal(verdictTitle(d).zh, "红海（结构性限制）");
  assert.deepEqual(
    d.users!.map((u) => u.pains),
    [["P1"]],
  );
  raw.verdict = { kind: "stop", cause: "nonsense", reason: text };
  assert.equal(
    verdictTitle(
      finalizeDecision(
        parseDecisionDraft(raw, citations),
        withPages(),
        sources,
      ),
    ).zh,
    "红海",
  );
  raw.verdict = { kind: "reframe", cause: "saturated", reason: text };
  raw.pains = [{ title: text, workaround: null, quotes: ["S4Q1"] }];
  const none = finalizeDecision(
    parseDecisionDraft(raw, citations),
    withPages(),
    sources,
  );
  assert.equal(verdictTitle(none).zh, "待验证（缺少用户反馈）");
  assert.equal(none.users, undefined);
});

test("user analysis falls back to the title's scoping when the model leaves it out", () => {
  const raw: any = draft();
  delete raw.users;
  const m = withPages();
  const who = t("Hobby beekeepers.", "业余养蜂人。");
  const task = t("Weigh hives and keep records.", "给蜂箱称重并记账。");
  m.topic.plan = { ...(m.topic.plan as any), framing: { who, task } };
  const d = finalizeDecision(parseDecisionDraft(raw, citations), m, sources);
  assert.deepEqual(d.users, [
    { who, scenario: task, pains: d.pains.map((p) => p.id) },
  ]);
});

test("a site-scoped search keeps its whole page, and only results on the subject", () => {
  const hit = (title: string, url: string, excerpt = "") => ({
    kind: "organic" as const,
    title,
    url,
    excerpt,
  });
  const web: any = {
    fetchedAt: "2026-10-09T00:00:00Z",
    region: "US",
    language: "en",
    queries: [
      {
        query: "site:reddit.com Terraria custom map",
        intent: "demand",
        engine: "brave",
        state: "ready",
        results: [
          ...Array.from({ length: 8 }, (_, i) =>
            hit(
              `r/Terraria on Reddit: custom maps ${i}`,
              `https://www.reddit.com/r/Terraria/comments/a${i}/x/`,
              "How are people making custom maps in Terraria these days, any pointers?",
            ),
          ),
          hit(
            "r/Terraria on Reddit: 最好的地图编辑器是什么？",
            "https://www.reddit.com/r/Terraria/comments/2b2wtb/x/?tl=zh-hans",
            "我想为朋友做一张 Terraria custom map，哪个编辑器最适合挖空一个世界？",
          ),
          hit(
            "r/Terraria on Reddit: fan art",
            "https://www.reddit.com/r/Terraria/comments/b1/art/",
            "I drew the Terraria bosses over the weekend and wanted to share them with everyone.",
          ),
        ],
      },
      {
        query: "site:fiverr.com terraria",
        intent: "competition",
        engine: "brave",
        state: "ready",
        results: [
          hit(
            "Masterper: I will make a realistic terrain map in roblox for $30 on fiverr.com",
            "https://www.fiverr.com/masterper/make-a-cheap-realistic-terraria-map",
          ),
          hit(
            "Ssemii: I will build anything you want in terraria for $5 on fiverr.com",
            "https://www.fiverr.com/ssemii/build-anything-you-want-in-terraria",
          ),
        ],
      },
    ],
  };
  // The mixed selection keeps four results of a search; the scoped one all ten.
  assert.equal(
    searchSources(web).filter((s) => s.url.includes("reddit.com")).length,
    4,
  );
  const scoped = scopedSources(web);
  assert.equal(scoped.filter((s) => s.url.includes("reddit.com")).length, 10);
  const kept = scoped.filter((s) => onTopic(s) && forumWords(s).excerpt);
  // Fan art names the subject but none of the other search words; the
  // translated thread is not the poster's own words.
  assert.equal(kept.filter((s) => s.url.includes("reddit.com")).length, 8);
  // A seller's address keeps the words of an offer since rewritten.
  assert.deepEqual(
    scoped.filter((s) => s.url.includes("fiverr.com") && onTopic(s)).length,
    1,
  );
  assert.equal(
    forumWords({
      label: "泰拉瑞亚tedit地图编辑器求一个高版本的_terraria吧_百度贴吧",
      url: "https://tieba.baidu.com/p/6877024035",
      excerpt:
        "x Snippet: 用tedit打开世界后读取不了，tedit最高支持187，当前世界194。强制加载后保存",
    } as any).label,
    "terraria吧：泰拉瑞亚tedit地图编辑器求一个高版本的",
  );
  for (const label of [
    "10 个住宅 IP 兑换码，双 ISP+不限并发，店铺/社媒/采集/广告",
    "9HTTP✅免费试用 500M✅美国 IP $2.45/IP",
    "谁需要住宅 IP？送动态 IP 流量（采集/店铺/社媒/抢货都能用）",
  ])
    assert.equal(
      forumWords({
        label,
        url: "https://www.v2ex.com/t/1227360",
        excerpt:
          "x Snippet: 专为大数据采集、跨境电商、社媒矩阵打造，主打无限流量",
      } as any).excerpt,
      "",
    );
});

test("a follow-up answer stops at five sentences without cutting a decimal", () => {
  assert.equal(
    sentences("一。二！三？四。五，含 3.5 美元。六。七。", 5),
    "一。二！三？四。五，含 3.5 美元。",
  );
  assert.equal(sentences("短答。", 5), "短答。");
});

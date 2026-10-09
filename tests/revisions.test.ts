import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/index.js";
import { Engine } from "../src/core/engine.js";
import { Store } from "../src/core/store.js";
import { finalizeDecision, parseDecisionDraft } from "../src/core/decision.js";
import { reportCitations } from "../src/core/report-contract.js";
import type { Market, ResearchSource } from "../src/core/types.js";

const text = { en: "Short English sentence.", zh: "一句简短的中文。" };
const sources: ResearchSource[] = [
  {
    id: "S1",
    label: "Trends",
    url: "https://trends.google.com/",
    excerpt: "{}",
  },
  {
    id: "S2",
    label: "Ask HN",
    url: "https://news.ycombinator.com/item?id=1",
    documentType: "hn-comment",
    excerpt: "We keep getting banned every few days reading logged-in posts.",
  },
  {
    id: "S3",
    label: "Acme pricing",
    url: "https://acme.example/pricing",
    documentType: "page",
    searchIntent: "competition",
    excerpt: "Starter is $49 per month and does not include logged-in content.",
  },
];
const draft = (pains = true) => ({
  verdict: { kind: pains ? "reframe" : "insufficient", reason: text },
  pains: pains ? [{ title: text, workaround: text, quotes: ["S2Q1"] }] : [],
  commercial: [
    {
      name: "Acme",
      audience: text,
      pricing: text,
      gap: text,
      evidence: ["S3Q1"],
    },
  ],
  openSource: [],
  directions: pains
    ? [
        {
          title: text,
          audience: text,
          pain: "P1",
          supply: ["C1"],
          whyOpen: text,
          uncertainty: text,
        },
      ]
    : [],
  nextStep: pains ? { who: text, ask: text, success: text, fail: text } : null,
  unverified: [text],
});

async function harness(
  work: (x: {
    engine: Engine;
    post: (path: string, body?: unknown) => Promise<Response>;
    get: (path: string) => Promise<any>;
    id: string;
    legacy: string;
  }) => Promise<void>,
) {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-revisions-"));
  const engine = new Engine(new Store(dir));
  const server = createApp(engine).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const seed: Market = JSON.parse(
    readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
  )[0];
  const market: Market = { ...structuredClone(seed), id: "aaaaaaaaaaaaaaa1" };
  market.brief = {
    model: "test",
    generatedAt: new Date().toISOString(),
    en: { summary: "x", nextSteps: [] },
    zh: { summary: "x", nextSteps: [] },
    sources,
    decision: finalizeDecision(
      parseDecisionDraft(draft(), reportCitations(sources)),
      market,
      sources,
    ),
  };
  engine.store.saveMarket(market);
  engine.store.saveMarket({ ...structuredClone(seed), id: "aaaaaaaaaaaaaaa2" });
  Object.defineProperty(engine.research, "enabled", { value: true });
  try {
    await work({
      engine,
      id: market.id,
      legacy: "aaaaaaaaaaaaaaa2",
      get: async (path) => (await fetch(base + path)).json(),
      post: (path, body) =>
        fetch(base + path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body || {}),
        }),
    });
  } finally {
    server.close();
    await engine.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("dismissing a quote is instant, validated and reversible; status is one field", async () => {
  await harness(async ({ post, get, id, legacy, engine }) => {
    assert.deepEqual(await get(`/api/reports/${id}/revision`), {
      revision: null,
      followupsLeft: 20,
    });
    assert.equal(
      (await post(`/api/reports/${id}/revision`, { dismiss: "P9:S9Q9" }))
        .status,
      400,
    );
    let view = await (
      await post(`/api/reports/${id}/revision`, { dismiss: "P1:S2Q1" })
    ).json();
    assert.deepEqual(view.revision.dismissed, ["P1:S2Q1"]);
    assert.equal(view.revision.stale, true);
    view = await (
      await post(`/api/reports/${id}/revision`, { restore: "P1:S2Q1" })
    ).json();
    assert.deepEqual(view.revision.dismissed, []);
    assert.equal(view.revision.stale, false);
    view = await (
      await post(`/api/reports/${id}/revision`, { status: "won" })
    ).json();
    assert.equal(view.revision.status, "won");
    assert.equal(
      (await post(`/api/reports/${id}/revision`, { status: "maybe" })).status,
      400,
    );
    assert.equal(
      (await post(`/api/reports/${legacy}/revision`, { status: "won" })).status,
      409,
    );
    assert.ok(
      engine.store.report(id)?.brief?.decision?.nextStep,
      "the delivered report is untouched",
    );
  });
});

test("a new judgment never sees removed quotes, and a failed one keeps the corrections", async () => {
  await harness(async ({ post, id, engine }) => {
    await post(`/api/reports/${id}/revision`, { dismiss: "P1:S2Q1" });
    let seen: any;
    // The model tries to cite the removed quote: rejected, nothing is saved.
    engine.research.json = async (_p, input) => {
      seen = input;
      return draft();
    };
    const rejected = await post(`/api/reports/${id}/rejudge`);
    assert.equal(rejected.status, 502);
    assert.ok(!JSON.stringify(seen.sources).includes("S2Q1"));
    assert.equal(seen.readerCorrections.removedAsIrrelevant, 1);
    assert.deepEqual(engine.store.revision(id)?.dismissed, ["P1:S2Q1"]);
    assert.equal(engine.store.revision(id)?.decision, undefined);
    engine.research.json = async () => draft(false);
    const view = await (await post(`/api/reports/${id}/rejudge`)).json();
    assert.equal(view.revision.decision.verdict.kind, "insufficient");
    assert.deepEqual(view.revision.decision.directions, []);
    assert.deepEqual(view.revision.excluded, ["S2Q1"]);
    assert.deepEqual(view.revision.dismissed, []);
    assert.equal(view.revision.stale, false);
  });
});

/** A follow-up replies in JSON lines; the result is the last one. */
const lines = async (r: Response) =>
  (await r.text())
    .trim()
    .split("\n")
    .map((x) => JSON.parse(x));

test("follow-ups answer from collected sources, drop invented citations and are bounded", async () => {
  await harness(async ({ post, id, engine }) => {
    let operation = "";
    engine.research.json = async (_p, _i, _m, op) => {
      operation = op!;
      return {
        calls: [],
        answer: "Acme's starter plan excludes it.",
        quotes: ["S3Q1", "S99Q1"],
        update: false,
      };
    };
    const [view] = await lines(
      await post(`/api/reports/${id}/ask`, { question: "Why not Acme?" }),
    );
    assert.equal(operation, "report-ask");
    assert.equal(view.followupsLeft, 19);
    assert.deepEqual(
      view.revision.followups[0].quotes.map((q: any) => q.cid),
      ["S3Q1"],
    );
    assert.equal(view.revision.sources, undefined);
    engine.research.json = async () => {
      throw new Error("boom");
    };
    const failed = await post(`/api/reports/${id}/ask`, { question: "Again?" });
    assert.equal(failed.status, 502);
    assert.equal(
      engine.store.revision(id)?.followups?.length,
      1,
      "not counted",
    );
    assert.equal(
      (await post(`/api/reports/${id}/ask`, { question: "x" })).status,
      400,
    );
  });
});

test("a follow-up can search and read in steps, and only sources the new judgment uses stay", async () => {
  await harness(async ({ post, id, engine }) => {
    engine.trends.forResearch = () =>
      ({ researchProxy: () => undefined, close: async () => {} }) as any;
    engine.documents.forResearch = () => engine.documents;
    const searched: string[] = [];
    engine.search.collect = async (_t, _g, queries) => {
      searched.push(queries![0]!.query);
      return {
        fetchedAt: new Date().toISOString(),
        region: "US",
        language: "en",
        queries: [
          {
            ...queries![0]!,
            engine: "google",
            results: [
              {
                kind: "organic",
                title: "Banned again : r/scraping",
                url: "https://www.reddit.com/r/scraping/comments/1/banned/",
                excerpt:
                  "My account gets banned every week when I read logged-in posts, I am tired of making new ones.",
              },
              {
                kind: "organic",
                title: "Unrelated thread : r/cats",
                url: "https://www.reddit.com/r/cats/comments/2/cat/",
                excerpt:
                  "My cat sleeps on the keyboard all day and I can not get any work done at all.",
              },
              {
                kind: "organic",
                title: "Bolt review",
                url: "https://reviews.example/bolt",
                excerpt: "We tested Bolt for a month.",
              },
            ],
          },
        ],
      } as any;
    };
    engine.documents.readWeb = async (url) => ({
      cached: false,
      read: { url, status: "read", observedAt: new Date().toISOString() },
      sources: [
        {
          label: "Bolt review",
          url,
          excerpt: "Bolt lost our session twice a day during the test.",
        },
      ],
    });
    const turns: any[] = [];
    engine.research.json = async (_p, input: any, _m, op) => {
      if (op === "report-rejudge") {
        const next = draft();
        next.pains[0]!.quotes.push("S4Q1");
        return next;
      }
      turns.push(input);
      if (turns.length === 1)
        return {
          calls: [
            { tool: "search", q: "account banned", site: "reddit" },
            { tool: "read", url: "https://invented.example/" },
          ],
        };
      if (turns.length === 2)
        return {
          calls: [
            {
              tool: "read",
              url: "https://reviews.example/bolt",
              vendor: false,
            },
          ],
        };
      return {
        calls: [],
        answer: "People report weekly bans (S4, S5Q1).",
        quotes: ["S4Q1"],
        update: true,
      };
    };
    const out = await lines(
      await post(`/api/reports/${id}/ask`, { question: "Go deeper" }),
    );
    assert.deepEqual(searched, ["site:reddit.com account banned"]);
    assert.deepEqual(
      out.slice(0, -1).map((x) => x.step.tool),
      ["search", "read", "rejudge"],
    );
    assert.match(turns[1].done[0].outcome, /^2 forum posts added.*1 pages/);
    assert.match(turns[1].done[1].outcome, /^rejected/);
    assert.equal(turns[2].sources.at(-1).id, "S6");
    const { revision } = out.at(-1);
    assert.deepEqual(
      revision.sources.map((s: any) => s.id),
      ["S4"],
      "the cat thread and the unused review are dropped",
    );
    assert.equal(revision.decision.pains[0].quotes.length, 2);
    assert.equal(revision.followups[0].note, "more-research");
    assert.equal(revision.followups[0].answer, "People report weekly bans.");
    assert.deepEqual(
      revision.followups[0].steps.map((s: any) => s.tool),
      ["search", "read"],
    );
  });
});

test("an added supplier is read from its own page before the report is judged again", async () => {
  await harness(async ({ post, id, engine }) => {
    engine.trends.forResearch = () =>
      ({ researchProxy: () => undefined, close: async () => {} }) as any;
    engine.documents.forResearch = () => engine.documents;
    let status: "read" | "access" = "access";
    engine.documents.readWeb = async (url) => ({
      cached: false,
      read: { url, status, observedAt: new Date().toISOString() },
      sources:
        status === "read"
          ? [
              {
                label: "TikHub pricing",
                url,
                excerpt: "Pay as you go, logged-in endpoints cost ten credits.",
              },
            ]
          : [],
    });
    const blocked = await post(`/api/reports/${id}/supply`, {
      name: "https://tikhub.example/pricing",
    });
    assert.equal(blocked.status, 422);
    assert.equal(engine.store.revision(id), null, "nothing changed");
    status = "read";
    engine.research.json = async (_p, input: any) => {
      assert.equal(input.sources.at(-1).id, "S4");
      assert.deepEqual(input.readerCorrections.addedSuppliers, [
        "TikHub pricing",
      ]);
      const next = draft();
      next.commercial.push({
        name: "TikHub",
        audience: text,
        pricing: text,
        gap: text,
        evidence: ["S4Q1"],
      });
      return next;
    };
    const view = await (
      await post(`/api/reports/${id}/supply`, {
        name: "https://tikhub.example/pricing",
      })
    ).json();
    const rows = view.revision.decision.commercial;
    assert.deepEqual(
      rows.map((x: any) => [x.name, !!x.added]),
      [
        ["Acme", false],
        ["TikHub", true],
      ],
    );
    assert.equal(view.revision.sources[0].id, "S4");
    // A later judgment that forgets a row the reader already has gets it back.
    engine.research.json = async () => {
      const next = draft();
      next.commercial = [
        {
          name: "TikHub",
          audience: text,
          pricing: text,
          gap: text,
          evidence: ["S4Q1"],
        },
      ];
      next.directions[0]!.supply = ["C1"];
      return next;
    };
    const again = await (await post(`/api/reports/${id}/rejudge`)).json();
    assert.deepEqual(
      again.revision.decision.commercial.map((x: any) => x.name),
      ["TikHub", "Acme"],
    );
  });
});

test("a research has one address from the first second, can be cancelled, and is listed", async () => {
  await harness(async ({ post, get, engine, id }) => {
    let release!: (m: Market) => void;
    let options: any;
    engine.scan = async (_input, o) => {
      options = o;
      return new Promise<Market>((resolve) => (release = resolve));
    };
    engine.research.plan = async (input) => ({
      ...engine.store.report(id)!.topic,
      slug: "custom-forms",
      name: input,
      keyword: input,
      aliases: [],
    });
    const started = await post("/api/scan", {
      topic: "self-hosted forms",
      geo: "",
    });
    assert.equal(started.status, 202);
    const job = await started.json();
    assert.match(job.reportId, /^[a-f0-9]{16}$/);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(options.reportId, job.reportId);
    assert.deepEqual(await get(`/api/reports/${job.reportId}`), {
      pending: true,
      job: job.id,
    });
    const list = await get("/api/researches");
    assert.equal(list.running[0].id, job.reportId);
    assert.equal(list.running[0].input, "self-hosted forms");
    // Listed research carries the verdict and what the owner did next.
    engine.store.addHistory("local", id, "sample");
    await post(`/api/reports/${id}/revision`, { status: "parked" });
    const mine = (await get("/api/researches")).items;
    assert.deepEqual(
      mine.map((x: any) => [x.id, x.verdict, x.status, x.actionable, x.legacy]),
      [[id, "reframe", "parked", true, false]],
    );
    assert.equal((await post(`/api/jobs/${job.id}/cancel`)).status, 200);
    release({ ...engine.store.report(id)!, id: job.reportId });
    await new Promise((r) => setTimeout(r, 30));
    const done = await get(`/api/jobs/${job.id}`);
    assert.equal(done.state, "failed");
    assert.equal((await get("/api/researches")).running.length, 0);
    const gone = await fetch(
      (started.url || "").replace("/api/scan", `/api/reports/${job.reportId}`),
    );
    assert.equal(gone.status, 404);
  });
});

test("the visitor sample is the newest shared report that reached a verdict", async () => {
  await harness(async ({ get, engine, id }) => {
    assert.equal(
      await get("/api/sample"),
      null,
      "unowned seeds are not samples",
    );
    const owned = { ...engine.store.report(id)!, id: "aaaaaaaaaaaaaaa3" };
    engine.store.saveMarket(owned, true, "someone");
    assert.equal((await get("/api/sample")).market.id, "aaaaaaaaaaaaaaa3");
  });
});

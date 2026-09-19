import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  capabilityProblems,
  capabilitySources,
  normalizeCapabilityAudit,
  capabilityIssues,
  capabilityEditPaths,
  applyCapabilityEdits,
  capabilityNotices,
} from "../src/core/capabilities.js";
import { Research } from "../src/providers/research.js";
import { Store } from "../src/core/store.js";
import type { ResearchSource } from "../src/core/types.js";
const docs: ResearchSource[] = [
  {
    id: "R1",
    kind: "project",
    documentType: "github-readme",
    label: "Salon notebook",
    url: "https://github.com/team/notebook/blob/main/README.md",
    excerpt:
      "**Notebook** stores pet profiles, grooming notes and visit photos. Offline access is a planned feature.",
  },
  {
    id: "L1",
    kind: "project",
    documentType: "license",
    label: "Notebook license",
    url: "https://github.com/team/notebook/blob/main/LICENSE",
    excerpt:
      "Permission is hereby granted, free of charge, to any person obtaining a copy of this software.",
  },
  {
    id: "I1",
    kind: "request",
    label: "A personal request",
    url: "https://github.com/team/notebook/issues/1",
    excerpt: "Please add appointment reminders.",
  },
  {
    id: "W1R1",
    kind: "search",
    label: "Snippet",
    url: "https://example.com/search",
    excerpt: "The best grooming software has every feature.",
  },
];
const draft = [
  {
    id: "grooming-notes",
    title: "Notes for groomers",
    offer: "A proposed offline record notebook.",
  },
];
const audit = () => ({
  directions: [
    {
      id: "grooming-notes",
      facts: [
        {
          id: "R1",
          quote:
            "**Notebook** stores pet profiles, grooming notes and visit photos.",
        },
      ],
      overlap: "partial" as const,
      proposedWork:
        "Verify the current offline behavior, then prototype a clearly scoped offline contribution.",
      prerequisites: [
        "Check the notebook code license, photo-use permission and browser storage compatibility.",
      ],
      nextCheck:
        "Compare an interrupted-network grooming session against the current notebook release.",
    },
  ],
});
async function fixture(fn: (r: Research, s: Store) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-capabilities-")),
    store = new Store(dir);
  try {
    await fn(new Research(store), store);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("capability facts retain original documents and source ownership; collection direction does not limit reuse", () => {
  assert.deepEqual(
    capabilitySources(docs).map((s) => s.id),
    ["R1", "L1"],
  );
  assert.deepEqual(capabilityProblems(audit(), docs, ["grooming-notes"]), []);
  for (const [id, quote] of [
    ["I1", docs[2]!.excerpt!],
    ["W1R1", docs[3]!.excerpt!],
    ["R1", "Notebook already supports automatic offline syncing."],
  ]) {
    const x = audit();
    x.directions[0]!.facts[0] = { id, quote };
    assert.ok(
      capabilityProblems(x, docs, ["grooming-notes"]).some((p) =>
        p.includes("exact original-document"),
      ),
    );
  }
  const license: any = audit();
  license.directions[0].facts[0] = {
    id: "L1",
    quote: docs[1]!.excerpt,
  };
  assert.ok(
    capabilityProblems(license, docs, ["grooming-notes"]).some((p) =>
      p.includes("product-document quote"),
    ),
  );
  assert.deepEqual(
    capabilityProblems(
      audit(),
      [{ ...docs[0]!, directionId: "another-task" }],
      ["grooming-notes"],
    ),
    [],
  );
  assert.ok(
    capabilityProblems(audit(), docs, ["another-task"]).some((p) =>
      p.includes("exactly one"),
    ),
  );
  const empty = audit();
  empty.directions[0]!.facts = [];
  assert.ok(
    capabilityProblems(empty, docs, ["grooming-notes"]).some((p) =>
      p.includes("overlap needs"),
    ),
  );
});

test("copyright, scoped license restrictions and legacy release observations retain exact provenance", () => {
  const x = audit();
  x.directions[0]!.facts.push({ id: "L1", quote: docs[1]!.excerpt! });
  const src = [
    ...docs,
    {
      ...docs[0]!,
      id: "R2",
      excerpt: "Copyright 2026 Pawtrackr. All rights reserved.",
    },
  ];
  x.directions[0]!.facts.push({ id: "R2", quote: src[4]!.excerpt! });
  assert.deepEqual(capabilityProblems(x, src, ["grooming-notes"]), []);
  x.directions[0]!.facts[0]!.id = "R2";
  assert.ok(
    capabilityProblems(x, src, ["grooming-notes"]).some((p) =>
      p.includes("same project/page"),
    ),
  );
  assert.equal(
    capabilitySources([
      {
        ...docs[0]!,
        documentType: undefined,
        url: "https://github.com/team/notebook/releases/tag/v1.2",
      },
    ]).length,
    1,
  );
});

test("feature selection retains explicit rights and testing notices from the same original document", () => {
  const source = {
    ...docs[0]!,
    excerpt:
      docs[0]!.excerpt + "\nCopyright 2026 Notebook. All rights reserved.",
  };
  const x = normalizeCapabilityAudit(audit(), [source]) as ReturnType<
    typeof audit
  >;
  assert.deepEqual(x.directions[0]!.facts[1], {
    id: "R1",
    quote: "Copyright 2026 Notebook. All rights reserved.",
  });
  assert.deepEqual(capabilityProblems(x, [source], ["grooming-notes"]), []);
  assert.deepEqual(normalizeCapabilityAudit(x, [source]), x);
  assert.deepEqual(
    capabilityNotices({ ...source, documentType: "license" }),
    [],
  );
  assert.deepEqual(
    capabilityNotices({
      ...source,
      excerpt: "Experimental build. Not for production use. Use with caution!",
    }),
    ["Experimental build. Not for production use. Use with caution!"],
  );
  assert.deepEqual(capabilityNotices({ ...source, kind: "request" }), []);
});

test("audit repair exposes quote errors alongside length errors and confines edits to rejected fields", () => {
  const x = audit();
  x.directions[0]!.proposedWork = "x".repeat(501);
  x.directions[0]!.facts[0]!.quote = "Invented offline synchronization.";
  const issues = capabilityIssues(x, docs, ["grooming-notes"]);
  const paths = capabilityEditPaths(issues);
  assert.deepEqual(paths.sort(), [
    "directions.0.facts",
    "directions.0.proposedWork",
  ]);
  assert.equal(issues.length, 2);
  const repaired = applyCapabilityEdits(
    x,
    {
      edits: [
        { path: "directions.0.facts", value: audit().directions[0]!.facts },
        {
          path: "directions.0.proposedWork",
          value: audit().directions[0]!.proposedWork,
        },
      ],
    },
    paths,
  );
  assert.deepEqual(repaired, audit());
  assert.equal(x.directions[0]!.proposedWork.length, 501);
  for (const path of [
    "directions.0.id",
    "directions.0.nextCheck",
    "__proto__.polluted",
  ]) {
    assert.throws(() =>
      applyCapabilityEdits(x, { edits: [{ path, value: "edited" }] }, paths),
    );
  }
  assert.throws(() =>
    applyCapabilityEdits(
      x,
      {
        edits: [
          { path: paths[0], value: [] },
          { path: paths[0], value: [] },
        ],
      },
      paths,
    ),
  );
  const y = audit();
  y.directions[0]!.proposedWork = "x".repeat(501);
  y.directions[0]!.facts[0]!.quote =
    "Notebook stores pet profiles, grooming notes and visit photos.";
  assert.equal(
    (normalizeCapabilityAudit(y, docs) as any).directions[0].facts[0].quote,
    audit().directions[0]!.facts[0]!.quote,
  );
});

test("capability quote recovery preserves source Markdown and evidence roles", () => {
  const x = audit();
  x.directions[0]!.facts[0]!.quote =
    "Notebook stores pet profiles, grooming notes and visit photos.";
  assert.deepEqual(normalizeCapabilityAudit(x, docs), audit());
  assert.deepEqual(
    x.directions[0]!.facts[0]!.quote,
    "Notebook stores pet profiles, grooming notes and visit photos.",
  );
  const request = {
    ...docs[0]!,
    kind: "request" as const,
    documentType: "page" as const,
  };
  assert.equal(capabilitySources([request]).length, 0);
});

test("a capability audit repairs exact-source violations once, caches accepted checks and uses source changes in cache identity", async () =>
  fixture(async (r, s) => {
    const operations: string[] = [];
    r.json = async (_p, input: any, _budget, op, thinking) => {
      operations.push(op!);
      assert.equal(thinking, false);
      assert.equal(_budget, 5000);
      assert.deepEqual(
        input.sources.map((s: any) => s.id),
        ["R1", "L1"],
      );
      const x = audit();
      if (op === "capability-audit")
        x.directions[0]!.facts[0]!.quote = "Invented offline synchronization.";
      else {
        assert.ok(
          input.requiredCorrections.some((x: string) =>
            x.includes("exact original-document"),
          ),
        );
        return {
          edits: [
            { path: "directions.0.facts", value: x.directions[0]!.facts },
          ],
        };
      }
      return x;
    };
    const context = { input: "grooming", sources: docs };
    assert.deepEqual(await r.auditCapabilities(context, draft), audit());
    assert.deepEqual(await r.auditCapabilities(context, draft), audit());
    assert.deepEqual(operations, [
      "capability-audit",
      "capability-audit-repair",
    ]);
    assert.equal(
      s
        .adminOverview(7, 0, "")
        .models.find((x) => x.operation === "capability-audit")?.cacheHits,
      1,
    );
    r.json = async () => {
      operations.push("changed-source");
      return audit();
    };
    await r.auditCapabilities(
      {
        ...context,
        sources: docs.map((s) => ({ ...s, fetchedAt: "2026-09-19T00:00:00Z" })),
      },
      draft,
    );
    assert.equal(operations.at(-1), "changed-source");
  }));

test("snippet-only evidence yields explicit checks with zero model calls; provider errors retain their recovery path", async () =>
  fixture(async (r) => {
    let calls = 0;
    r.json = async () => {
      calls++;
      throw Object.assign(new Error("rate limit"), { code: "http_429" });
    };
    const x = await r.auditCapabilities(
      { input: "grooming", sources: docs.slice(2) },
      draft,
    );
    assert.equal(calls, 0);
    assert.equal(x.directions[0]!.overlap, "to-check");
    assert.deepEqual(x.directions[0]!.facts, []);
    await assert.rejects(
      r.auditCapabilities({ input: "grooming", sources: docs }, draft),
      /rate limit/,
    );
    assert.equal(calls, 1);
  }));

test("invalid audits stop after two calls and never enter the accepted cache", async () =>
  fixture(async (r, s) => {
    let calls = 0;
    r.json = async () => {
      calls++;
      return { directions: [] };
    };
    await assert.rejects(
      r.auditCapabilities({ input: "grooming", sources: docs }, draft),
      /capability evidence/,
    );
    assert.equal(calls, 2);
    await assert.rejects(
      r.auditCapabilities({ input: "grooming", sources: docs }, draft),
      /capability evidence/,
    );
    assert.equal(calls, 4);
  }));

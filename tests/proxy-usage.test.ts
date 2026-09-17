import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Dispatcher } from "undici";
import { gzipSync } from "node:zlib";
import {
  ProxyUsageClient,
  parseSubscription,
  parseTraffic,
} from "../src/providers/proxy-usage.js";
import { TrafficMeter } from "../src/providers/trends.js";
import { Store } from "../src/core/store.js";
import { operationContext, type ProviderCall } from "../src/core/operations.js";

test("Decodo schemas preserve account units, unknown values and the current subscription format", () => {
  assert.deepEqual(
    parseSubscription([
      {
        service_type: "residential_proxies",
        traffic_limit: "1",
        traffic: "0.2",
        valid_until: "2027-09-16",
      },
    ]),
    { totalGb: 1, usedGb: 0.2, remainingGb: 0.8, validUntil: "2027-09-16" },
  );
  assert.equal(
    parseSubscription({
      service_type: "residential_proxies",
      traffic_limit: "1",
    }),
    null,
  );
  assert.equal(
    parseSubscription({
      service_type: "mobile_proxies",
      traffic_limit: 10,
      traffic: 1,
    }),
    null,
  );
  assert.equal(parseTraffic({ metadata: { totals: { requests: 0 } } }), null);
  assert.deepEqual(
    parseTraffic({
      metadata: { totals: { total_rx_tx: 0, requests: 0 } },
      data: [],
    }),
    { bytes: 0, requests: 0, daily: [] },
  );
});
test("official usage is cached and concurrent administrator refreshes share requests; errors expose only safe status", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proxy-usage-")),
    store = new Store(dir),
    original = globalThis.fetch,
    old = process.env.DECODO_API_KEY;
  process.env.DECODO_API_KEY = "private-api-key";
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "private-api-key",
    );
    return new Response(
      JSON.stringify(
        String(input).includes("subscriptions")
          ? [
              {
                service_type: "residential_proxies",
                traffic_limit: "1",
                traffic: ".1",
              },
            ]
          : {
              metadata: { totals: { total_rx_tx: 12345, requests: 4 } },
              data: [
                {
                  key: new Date().toISOString().slice(0, 10),
                  rx_tx_bytes: 12345,
                  requests: 4,
                },
              ],
            },
      ),
      { status: 200 },
    );
  };
  try {
    const client = new ProxyUsageClient(store),
      results = await Promise.all([client.overview(7), client.overview(7)]);
    assert.equal(calls, 2);
    assert.equal(results[0].state, "ready");
    assert.equal(results[0].subscription?.remainingGb, 0.9);
    await client.overview(7);
    assert.equal(calls, 2);
    assert.ok(!JSON.stringify(results).includes("private-api-key"));
    globalThis.fetch = async () =>
      new Response("private-api-key sensitive error", { status: 403 });
    const failed = await client.overview(1);
    assert.equal(failed.error, "authentication");
    assert.equal(failed.subscription, null);
    assert.ok(!JSON.stringify(failed).includes("private-api-key"));
  } finally {
    globalThis.fetch = original;
    if (old === undefined) delete process.env.DECODO_API_KEY;
    else process.env.DECODO_API_KEY = old;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("HTTP metering counts compressed payloads and failed responses while routes and scan averages survive storage", () => {
  const body = gzipSync("evidence ".repeat(1000));
  class Fake extends Dispatcher {
    dispatch(
      options: Dispatcher.DispatchOptions,
      handler: Dispatcher.DispatchHandler,
    ): boolean {
      handler.onHeaders?.(
        429,
        [Buffer.from("content-encoding"), Buffer.from("gzip")],
        () => {},
        "Too Many Requests",
      );
      handler.onData?.(body);
      return true;
    }
  }
  const call: ProviderCall = {
    provider: "trends",
    operation: "timeline",
    started: new Date().toISOString(),
    durationMs: 100,
    status: 429,
    error: "http_429",
    proxyRoute: "backup",
  };
  new TrafficMeter(new Fake(), call).dispatch(
    {
      path: "/api/example",
      method: "GET",
      headers: ["accept", "application/json"],
    },
    { onHeaders: () => true, onData: () => true },
  );
  assert.ok(call.transferBytes! > body.length);
  assert.ok(call.transferBytes! < 500);
  const dir = mkdtempSync(join(tmpdir(), "proxy-record-"));
  let store = new Store(dir);
  try {
    operationContext.run({ runId: "scan-a" }, () => store.recordCall(call));
    store.recordCall({ ...call, transferBytes: 500, proxyRoute: "primary" });
    store.close();
    store = new Store(dir);
    const traffic = store.adminOverview(1, 0, "").traffic as any;
    assert.equal(traffic.period.requests, 2);
    assert.equal(traffic.period.averageScanBytes, call.transferBytes);
    assert.equal(
      traffic.routes.find((r: any) => r.route === "backup").throttled,
      1,
    );
    assert.equal(traffic.period.bytes, call.transferBytes! + 500);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

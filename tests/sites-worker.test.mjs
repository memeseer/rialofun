import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import worker from "../worker/index.js";
import { runIndexer, tokenAmountFromTransaction, receivedRloFromTransaction } from "../worker/indexer.js";

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("falls back to index.html for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/flow/step-two?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/flow/step-two?source=share", "/index.html"]);
});

test("does not turn missing API or write requests into the app shell", async () => {
  for (const request of [
    new Request("https://example.test/api/missing", { headers: { accept: "application/json" } }),
    new Request("https://example.test/flow", { method: "POST", headers: { accept: "text/html" } }),
  ]) {
    let calls = 0;
    const response = await worker.fetch(request, {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
      },
    });

    assert.equal(response.status, 404);
    assert.equal(calls, 1);
  }
});

test("reports whether zero-cost storage bindings are active", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/health"), {
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, storage: false, imageStore: null });
});

test("stores a bounded token image in the R2 binding", async () => {
  let stored;
  const response = await worker.fetch(new Request("https://example.test/api/images", {
    method: "POST",
    headers: { "content-type": "image/webp" },
    body: new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]),
  }), {
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
    IMAGES: { head: async () => null, put: async (key, body, options) => { stored = { key, body, options }; } },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ meta: { changes: 1 } }) }) }) },
  });
  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.match(payload.url, /^\/api\/images\/tokens\/[a-f0-9]{64}\.webp$/);
  assert.equal(stored.options.httpMetadata.contentType, "image/webp");
});

test("rejects image payloads whose bytes do not match the declared MIME type", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/images", {
    method: "POST", headers: { "content-type": "image/webp" }, body: new Uint8Array([1, 2, 3, 4]),
  }), {
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
    IMAGES: { head: async () => null, put: async () => assert.fail("invalid image must not be stored") },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ meta: { changes: 1 } }) }) }) },
  });
  assert.equal(response.status, 415);
});

test("does not accept browser-submitted trade records", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/trades", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ marketId: "fake", signature: "fake" }),
  }), { DB: {}, ASSETS: { fetch: async () => new Response("missing", { status: 404 }) } });
  assert.equal(response.status, 405);
  assert.match((await response.json()).error, /on-chain indexer/);
});

test("rejects unsigned metadata before it can overwrite the shared profile", async () => {
  const queries = [];
  const DB = { prepare(query) { queries.push(query); return { bind() { return this; }, first: async () => null, run: async () => ({ meta: { changes: 1 } }) }; } };
  const response = await worker.fetch(new Request("https://example.test/api/metadata", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      id: "chain-abc", state: "state", mint: "mint", name: "Forged", ticker: "FAKE", creator: "11111111111111111111111111111111",
      image: "/api/images/tokens/fake.webp", launchSignature: "tx", description: "forged", createdAt: 1, signature: "bad",
    }),
  }), {
    DB,
    IMAGES: { head: async () => ({ key: "tokens/fake.webp" }) },
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  });
  assert.equal(response.status, 401);
  assert.equal(queries.some((query) => query.includes("INSERT INTO markets")), false);
});

test("keeps the indexer watermark unchanged when RPC has not returned a transaction", async () => {
  const statements = [];
  const DB = { prepare(query) { statements.push(query); return { bind() { return this; }, first: async () => null, run: async () => ({ meta: { changes: 1 } }) }; } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const result = body.method === "getSignaturesForAddress"
      ? { value: [{ signature: "delayed-signature", blockHeight: 4, blockTime: 1_700_000_000 }] }
      : null;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await runIndexer({ DB });
    assert.equal(result.indexed, 0);
    assert.equal(result.failed.signature, "delayed-signature");
    assert.equal(statements.some((query) => query.includes("latest_signature")), true);
    assert.equal(statements.filter((query) => query.includes("INSERT OR REPLACE INTO indexer_state")).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("indexes the exact minted amount when Rialo omits token balance arrays", () => {
  const mint = "H3sVswmiM42SNR4TKFp9JddkgZ7G6TsXKFKrrjaatc43";
  const keys = ["trader", "state", "token-account", mint, "system", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
  const transaction = { meta: { innerInstructions: [{ instructionIndex: 5, instruction: {
    accounts: [3, 2], data: "oicBcBFJmBuQH", programIdIndex: 5,
  } }] } };
  assert.equal(tokenAmountFromTransaction(transaction, 5, { tag: 0, mint, tokenAccountIndex: 2 }, keys), 31_945_788_964_182n);
  assert.equal(tokenAmountFromTransaction(transaction, 4, { tag: 0, mint, tokenAccountIndex: 2 }, keys), 0n);
});

test("does not mistake a transaction fee for sell proceeds when Rialo omits native balances", () => {
  assert.equal(receivedRloFromTransaction({ meta: { fee: 5000 } }, 0), 0);
  assert.equal(receivedRloFromTransaction({ meta: { fee: 5000, preBalances: [1_000_000_000], postBalances: [1_999_995_000] } }, 0), 1);
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
});

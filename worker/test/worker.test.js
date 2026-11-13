import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function mockEnv() {
  return {
    CORS_ORIGIN: "https://enderpkg.github.io",
    DB: {
      prepare() {
        return {
          bind() { return this; },
          async first() { return null; },
          async all() { return { results: [] }; }
        };
      }
    }
  };
}

test("health endpoint responds with service status", async () => {
  const response = await worker.fetch(
    new Request("https://api.example.test/api/health"),
    mockEnv()
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "enderpkg-api" });
});

test("unknown route returns 404", async () => {
  const response = await worker.fetch(
    new Request("https://api.example.test/nope"),
    mockEnv()
  );
  assert.equal(response.status, 404);
});

test("non-GET methods are rejected", async () => {
  const response = await worker.fetch(
    new Request("https://api.example.test/api/health", { method: "POST" }),
    mockEnv()
  );
  assert.equal(response.status, 405);
});

test("package list endpoint returns an empty list from empty database", async () => {
  const response = await worker.fetch(
    new Request("https://api.example.test/api/packages"),
    mockEnv()
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { packages: [] });
});

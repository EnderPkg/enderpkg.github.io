import test from "node:test";
import assert from "node:assert/strict";
import { parseEndpkgHeader } from "../src/header.js";

const validPackage = `-- #enderpkg
-- #name: "Example Package"
-- #author: "ExampleAuthor"
-- #version: "1.0.0"
-- #description: "Test package"
-- #license: "MIT"
-- #platform: "cc-tweaked"
-- #dependencies: [
--   "library-a@^1.2.0",
--   "library-b@~2.0.0"
-- ]

print("Hello from EndPkg!")
`;

test("accepts valid package metadata and returns Lua source", () => {
  const result = parseEndpkgHeader(validPackage);
  assert.equal(result.ok, true);
  assert.equal(result.metadata.name, "Example Package");
  assert.equal(result.metadata.version, "1.0.0");
  assert.equal(result.metadata.dependencies.length, 2);
  assert.match(result.sourceCode, /print\("Hello from EndPkg!"\)/);
});

test("requires exact marker on first line", () => {
  assert.equal(parseEndpkgHeader('\n-- #enderpkg\n').ok, false);
  assert.equal(parseEndpkgHeader('--  #enderpkg\n').ok, false);
  assert.equal(parseEndpkgHeader('-- #other\n').ok, false);
});

test("requires name, author and version", () => {
  const result = parseEndpkgHeader('-- #enderpkg\n-- #name: "x"\n-- #version: "1.0.0"\n');
  assert.equal(result.ok, false);
  assert.match(result.error, /author/);
});

test("rejects duplicate and unknown fields", () => {
  const duplicate = parseEndpkgHeader(
    '-- #enderpkg\n-- #name: "a"\n-- #name: "b"\n-- #author: "x"\n-- #version: "1.0.0"\n'
  );
  assert.match(duplicate.error, /Duplicate/);

  const unknown = parseEndpkgHeader(
    '-- #enderpkg\n-- #name: "a"\n-- #author: "x"\n-- #version: "1.0.0"\n-- #wat: "x"\n'
  );
  assert.match(unknown.error, /Unknown/);
});

test("rejects malformed JSON and invalid semantic versions", () => {
  const malformed = parseEndpkgHeader(
    '-- #enderpkg\n-- #name: Example\n-- #author: "x"\n-- #version: "1.0.0"\n'
  );
  assert.equal(malformed.ok, false);

  const badVersion = parseEndpkgHeader(
    '-- #enderpkg\n-- #name: "a"\n-- #author: "x"\n-- #version: "1.0"\n'
  );
  assert.match(badVersion.error, /MAJOR.MINOR.PATCH/);
});

test("accepts empty dependencies and rejects URL dependencies", () => {
  const empty = parseEndpkgHeader(
    '-- #enderpkg\n-- #name: "a"\n-- #author: "x"\n-- #version: "1.0.0"\n-- #dependencies: []\n\n'
  );
  assert.equal(empty.ok, true);

  const url = parseEndpkgHeader(
    '-- #enderpkg\n-- #name: "a"\n-- #author: "x"\n-- #version: "1.0.0"\n-- #dependencies: ["https://example.com/a.lua"]\n'
  );
  assert.equal(url.ok, false);
});

test("rejects malformed dependency arrays", () => {
  const result = parseEndpkgHeader(
    '-- #enderpkg\n-- #name: "a"\n-- #author: "x"\n-- #version: "1.0.0"\n-- #dependencies: [\n-- "bad"\n\n'
  );
  assert.equal(result.ok, false);
});

test("enforces the 20-line header limit", () => {
  const comments = Array(20).fill("-- ordinary comment").join("\n");
  const result = parseEndpkgHeader(
    `-- #enderpkg\n${comments}\n-- #name: "a"\n-- #author: "x"\n-- #version: "1.0.0"\n`
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /20-line/);
});

test("handles Windows line endings and UTF-8 BOM", () => {
  const windows = validPackage.replace(/\n/g, "\r\n");
  assert.equal(parseEndpkgHeader(windows).ok, true);
  assert.equal(parseEndpkgHeader("\uFEFF" + validPackage).ok, true);
});

test("rejects non-string and oversized input", () => {
  assert.equal(parseEndpkgHeader(null).ok, false);
  assert.equal(parseEndpkgHeader("x".repeat(2 * 1024 * 1024 + 1)).ok, false);
});

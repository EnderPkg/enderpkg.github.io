
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

test("accepts a valid EndPkg package", () => {
  const result = parseEndpkgHeader(validPackage);

  assert.equal(result.ok, true);
  assert.equal(result.metadata.name, "Example Package");
  assert.equal(result.metadata.version, "1.0.0");
  assert.equal(result.metadata.dependencies.length, 2);
  assert.match(result.sourceCode, /print\("Hello from EndPkg!"\)/);
});

test("rejects a missing marker", () => {
  const result = parseEndpkgHeader(
    '-- #name: "Example"\n-- #author: "Tester"\n-- #version: "1.0.0"'
  );

  assert.equal(result.ok, false);
});

test("rejects a marker that is not on line 1", () => {
  const result = parseEndpkgHeader(
    '\n-- #enderpkg\n-- #name: "Example"\n-- #author: "Tester"\n-- #version: "1.0.0"'
  );

  assert.equal(result.ok, false);
});

test("rejects missing required fields", () => {
  const result = parseEndpkgHeader(
    '-- #enderpkg\n-- #name: "Example"\n-- #version: "1.0.0"\n'
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /author/);
});

test("rejects duplicate fields", () => {
  const result = parseEndpkgHeader(
    '-- #enderpkg\n' +
    '-- #name: "First"\n' +
    '-- #name: "Second"\n' +
    '-- #author: "Tester"\n' +
    '-- #version: "1.0.0"\n'
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /Duplicate/);
});

test("rejects unknown fields", () => {
  const result = parseEndpkgHeader(
    '-- #enderpkg\n' +
    '-- #name: "Example"\n' +
    '-- #author: "Tester"\n' +
    '-- #version: "1.0.0"\n' +
    '-- #unknown: "value"\n'
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown metadata field/);
});

test("rejects invalid version numbers", () => {
  const result = parseEndpkgHeader(
    '-- #enderpkg\n' +
    '-- #name: "Example"\n' +
    '-- #author: "Tester"\n' +
    '-- #version: "1.0"\n'
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /MAJOR.MINOR.PATCH/);
});

test("rejects malformed JSON metadata", () => {
  const result = parseEndpkgHeader(
    '-- #enderpkg\n' +
    '-- #name: Example\n' +
    '-- #author: "Tester"\n' +
    '-- #version: "1.0.0"\n'
  );

  assert.equal(result.ok, false);
});

test("rejects invalid dependencies", () => {
  const result = parseEndpkgHeader(
    '-- #enderpkg\n' +
    '-- #name: "Example"\n' +
    '-- #author: "Tester"\n' +
    '-- #version: "1.0.0"\n' +
    '-- #dependencies: ["https://evil.example/file.lua"]\n'
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid dependency/);
});

test("rejects headers longer than 20 lines", () => {
  const comments = Array(20).fill("-- ordinary comment").join("\n");

  const result = parseEndpkgHeader(
    `-- #enderpkg\n${comments}\n` +
    '-- #name: "Example"\n' +
    '-- #author: "Tester"\n' +
    '-- #version: "1.0.0"\n'
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /20-line limit/);
});

test("accepts Windows line endings", () => {
  const source = validPackage.replace(/\n/g, "\r\n");
  const result = parseEndpkgHeader(source);

  assert.equal(result.ok, true);
});

test("rejects non-string input", () => {
  const result = parseEndpkgHeader(null);

  assert.equal(result.ok, false);
});

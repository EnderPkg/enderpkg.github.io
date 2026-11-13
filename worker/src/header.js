const REQUIRED_FIELDS = ["name", "author", "version"];
const ALLOWED_FIELDS = new Set([
  "name", "author", "description", "version",
  "license", "platform", "dependencies"
]);

const MAX_HEADER_LINES = 20;
const MAX_DEPENDENCIES = 50;
const MAX_SOURCE_LENGTH = 2 * 1024 * 1024;

function fail(error) {
  return { ok: false, error };
}

function parseJsonValue(rawValue, field) {
  try {
    return JSON.parse(rawValue);
  } catch {
    throw new Error(`Invalid JSON value for "${field}".`);
  }
}

function isValidDependency(value) {
  return typeof value === "string" &&
    /^[a-z0-9][a-z0-9-]*@(?:\^|~|>=|<=|>|<|=)?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(value);
}

export function parseEndpkgHeader(source) {
  if (typeof source !== "string") return fail("Source must be a string.");
  if (source.length > MAX_SOURCE_LENGTH) return fail("Source exceeds the 2 MiB parser limit.");

  const normalized = source.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r\n|\n|\r/);

  if (lines[0] !== "-- #enderpkg") {
    return fail('Missing exact marker "-- #enderpkg" on line 1.');
  }

  const metadata = {};
  let index = 1;
  let headerLines = 1;
  let headerEnded = false;

  try {
    while (index < lines.length) {
      const line = lines[index];

      if (line.trim() === "") {
        headerEnded = true;
        index++;
        break;
      }

      if (!/^\s*--/.test(line)) {
        headerEnded = true;
        break;
      }

      headerLines++;
      if (headerLines > MAX_HEADER_LINES) {
        return fail("Header exceeds the 20-line limit.");
      }

      const content = line.replace(/^\s*--\s?/, "").trim();
      index++;

      if (!content.startsWith("#")) continue;

      const match = content.match(/^#([a-z_]+)\s*:\s*(.*?)\s*$/);
      if (!match) return fail(`Invalid metadata syntax on line ${index}.`);

      const field = match[1];
      let rawValue = match[2];

      if (!ALLOWED_FIELDS.has(field)) return fail(`Unknown metadata field: "${field}".`);
      if (Object.hasOwn(metadata, field)) return fail(`Duplicate metadata field: "${field}".`);

      if (field === "dependencies" && rawValue.startsWith("[")) {
        let balance = 0;
        let inString = false;
        let escaped = false;

        const scanBalance = (text) => {
          for (const char of text) {
            if (inString) {
              if (escaped) escaped = false;
              else if (char === "\\") escaped = true;
              else if (char === '"') inString = false;
            } else {
              if (char === '"') inString = true;
              else if (char === "[") balance++;
              else if (char === "]") balance--;
            }
          }
        };

        scanBalance(rawValue);
        while (balance > 0) {
          if (index >= lines.length) return fail("Unclosed dependencies array.");
          const nextLine = lines[index];
          if (!/^\s*--/.test(nextLine)) {
            return fail("Dependencies array must stay inside comment lines.");
          }
          headerLines++;
          if (headerLines > MAX_HEADER_LINES) {
            return fail("Header exceeds the 20-line limit.");
          }
          const nextContent = nextLine.replace(/^\s*--\s?/, "").trim();
          rawValue += "\n" + nextContent;
          scanBalance(nextContent);
          index++;
        }
        if (balance < 0) return fail("Malformed dependencies array.");
      }

      metadata[field] = parseJsonValue(rawValue, field);
    }

    if (!headerEnded && index >= lines.length) headerEnded = true;

    for (const field of REQUIRED_FIELDS) {
      if (typeof metadata[field] !== "string" || metadata[field].trim() === "") {
        return fail(`Missing or invalid required field: "${field}".`);
      }
    }

    const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
    if (!semver.test(metadata.version)) {
      return fail("Version must use MAJOR.MINOR.PATCH format.");
    }

    for (const field of ["name", "author", "description", "license", "platform"]) {
      if (metadata[field] !== undefined &&
          (typeof metadata[field] !== "string" ||
           metadata[field].trim() === "" ||
           metadata[field].length > 200)) {
        return fail(`Invalid value for "${field}".`);
      }
    }

    if (metadata.dependencies !== undefined) {
      if (!Array.isArray(metadata.dependencies) ||
          metadata.dependencies.length > MAX_DEPENDENCIES) {
        return fail("Dependencies must be an array with at most 50 entries.");
      }
      if (!metadata.dependencies.every(isValidDependency)) {
        return fail("Invalid dependency entry.");
      }
      if (new Set(metadata.dependencies).size !== metadata.dependencies.length) {
        return fail("Duplicate dependency entry.");
      }
    }

    return {
      ok: true,
      metadata,
      headerLines,
      sourceCode: lines.slice(index).join("\n")
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Invalid header.");
  }
}

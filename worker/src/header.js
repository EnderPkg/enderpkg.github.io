
const REQUIRED_FIELDS = ["name", "author", "version"];

const ALLOWED_FIELDS = new Set([
  "name",
  "author",
  "description",
  "version",
  "license",
  "platform",
  "dependencies"
]);

const MAX_HEADER_LINES = 20;
const MAX_DEPENDENCIES = 50;

function fail(error) {
  return {
    ok: false,
    error
  };
}

function parseJsonValue(value, field) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Invalid JSON value for "${field}".`);
  }
}

export function parseEndpkgHeader(source) {
  if (typeof source !== "string") {
    return fail("Source must be a string.");
  }

  // Handle UTF-8 BOM and different line endings.
  const normalized = source.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r\n|\n|\r/);

  // The marker must be on the very first line.
  if (lines[0] !== "-- #enderpkg") {
    return fail('Missing marker "-- #enderpkg" on line 1.');
  }

  const metadata = {};
  let lineIndex = 1;
  let headerLineCount = 1;
  let headerEnded = false;

  try {
    while (lineIndex < lines.length) {
      const line = lines[lineIndex];

      // Empty line or first non-comment line ends the header.
      if (line.trim() === "" || !/^\s*--/.test(line)) {
        headerEnded = true;
        break;
      }

      headerLineCount++;

      if (headerLineCount > MAX_HEADER_LINES) {
        return fail("Header exceeds the 20-line limit.");
      }

      const content = line.replace(/^\s*--\s?/, "").trim();
      lineIndex++;

      // Ignore ordinary Lua comments inside the header.
      if (!content.startsWith("#")) {
        continue;
      }

      const match = content.match(/^#([a-z_]+)\s*:\s*(.*?)\s*$/);

      if (!match) {
        return fail(`Invalid metadata syntax on line ${lineIndex}.`);
      }

      const field = match[1];
      let rawValue = match[2];

      if (!ALLOWED_FIELDS.has(field)) {
        return fail(`Unknown metadata field: "${field}".`);
      }

      if (Object.hasOwn(metadata, field)) {
        return fail(`Duplicate metadata field: "${field}".`);
      }

      // Read multiline JSON arrays, currently used for dependencies.
      if (field === "dependencies" && rawValue.startsWith("[")) {
        while (!rawValue.includes("]")) {
          if (lineIndex >= lines.length) {
            return fail("Unclosed dependencies array.");
          }

          const nextLine = lines[lineIndex];

          if (!/^\s*--/.test(nextLine)) {
            return fail("Dependencies array must stay inside the comment header.");
          }

          headerLineCount++;

          if (headerLineCount > MAX_HEADER_LINES) {
            return fail("Header exceeds the 20-line limit.");
          }

          rawValue += "\n" + nextLine.replace(/^\s*--\s?/, "").trim();
          lineIndex++;
        }
      }

      metadata[field] = parseJsonValue(rawValue, field);
    }

    // A header must have a clear end before Lua code.
    if (!headerEnded && lineIndex >= lines.length) {
      // End of file directly after metadata is allowed.
      headerEnded = true;
    }

    for (const field of REQUIRED_FIELDS) {
      if (
        typeof metadata[field] !== "string" ||
        metadata[field].trim() === ""
      ) {
        return fail(`Missing or invalid required field: "${field}".`);
      }
    }

    // Validate semantic version: MAJOR.MINOR.PATCH
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(metadata.version)) {
      return fail("Version must use MAJOR.MINOR.PATCH format.");
    }

    for (const field of ["name", "author", "description", "license", "platform"]) {
      if (
        metadata[field] !== undefined &&
        (typeof metadata[field] !== "string" || metadata[field].length > 200)
      ) {
        return fail(`Invalid value for "${field}".`);
      }
    }

    if (metadata.dependencies !== undefined) {
      if (
        !Array.isArray(metadata.dependencies) ||
        metadata.dependencies.length > MAX_DEPENDENCIES
      ) {
        return fail("Dependencies must be an array with at most 50 entries.");
      }

      for (const dependency of metadata.dependencies) {
        if (
          typeof dependency !== "string" ||
          !/^[a-z0-9][a-z0-9-]*@(?:\^|~|>=|<=|>|<|=)?\d+\.\d+\.\d+$/.test(dependency)
        ) {
          return fail(`Invalid dependency: "${dependency}".`);
        }
      }
    }

    return {
      ok: true,
      metadata,
      headerLines: headerLineCount,
      sourceCode: lines.slice(lineIndex).join("\n")
    };

  } catch (error) {
    return fail(error.message);
  }
}

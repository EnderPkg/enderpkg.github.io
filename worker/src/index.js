import { parseEndpkgHeader } from "./header.js";

const MAX_BYTES = 2 * 1024 * 1024;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers }
  });
}

function corsHeaders(origin, env) {
  const headers = {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization"
  };
  if (origin && env.CORS_ORIGIN && origin === env.CORS_ORIGIN) {
    headers["access-control-allow-origin"] = env.CORS_ORIGIN;
    headers.vary = "Origin";
  }
  return headers;
}

function authorized(request, env) {
  const token = env.ADMIN_TOKEN;
  const supplied = request.headers.get("Authorization") || "";
  return typeof token === "string" &&
    token.length >= 32 &&
    supplied === `Bearer ${token}`;
}

function validateSource(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) return null;

  const parts = url.pathname.split("/").filter(Boolean);

  if (
    url.hostname === "raw.githubusercontent.com" &&
    parts.length >= 4
  ) {
    return { url: url.href, provider: "github" };
  }

  if (
    url.hostname === "pastebin.com" &&
    /^\/raw\/[A-Za-z0-9]+$/.test(url.pathname)
  ) {
    return { url: url.href, provider: "pastebin" };
  }

  return null;
}

function slugify(name) {
  return name.toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function compareVersions(a, b) {
  const aa = a.split(".").map(Number);
  const bb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (aa[i] > bb[i]) return 1;
    if (aa[i] < bb[i]) return -1;
  }
  return 0;
}

async function readLimited(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) throw new Error("File exceeds 2 MiB.");

  if (!response.body) throw new Error("Empty response body.");

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;

    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error("File exceeds 2 MiB.");
    }
    chunks.push(value);
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchSource(sourceUrl) {
  const valid = validateSource(sourceUrl);
  if (!valid) throw new Error("Source URL is not allowed.");

  const response = await fetch(valid.url, {
    method: "GET",
    redirect: "manual",
    headers: { "user-agent": "EndPkg/0.2" },
    signal: AbortSignal.timeout(15000)
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error("Redirects are not accepted.");
  }
  if (!response.ok) {
    throw new Error(`Source returned HTTP ${response.status}.`);
  }

  const bytes = await readLimited(response);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return { source, bytes };
}

async function registerSource(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (typeof body.url !== "string") {
    return json({ error: "A source URL is required." }, 400);
  }

  const source = validateSource(body.url);
  if (!source) {
    return json({
      error: "Only HTTPS raw.githubusercontent.com and pastebin.com/raw URLs are accepted."
    }, 400);
  }

  await env.DB.prepare(`
    INSERT OR IGNORE INTO sources (provider, source_url)
    VALUES (?, ?)
  `).bind(source.provider, source.url).run();

  const record = await env.DB.prepare(
    "SELECT id FROM sources WHERE source_url = ?"
  ).bind(source.url).first();

  await env.DB.prepare(`
    INSERT INTO scan_jobs (source_id, status)
    VALUES (?, 'queued')
  `).bind(record.id).run();

  return json({
    ok: true,
    source_id: record.id,
    provider: source.provider,
    status: "queued"
  }, 201);
}

async function processJob(env, job) {
  try {
    const sourceRecord = await env.DB.prepare(`
      SELECT id, source_url
      FROM sources
      WHERE id = ? AND enabled = 1
    `).bind(job.source_id).first();

    if (!sourceRecord) throw new Error("Source not found or disabled.");

    const { source, bytes } = await fetchSource(sourceRecord.source_url);
    const parsed = parseEndpkgHeader(source);

    if (!parsed.ok) throw new Error(`Invalid EndPkg header: ${parsed.error}`);

    const metadata = parsed.metadata;
    const slug = slugify(metadata.name);

    if (!slug) throw new Error("Package name cannot produce a valid slug.");

    const platform = metadata.platform || "cc-tweaked";
    if (platform !== "cc-tweaked") {
      throw new Error("Unsupported platform.");
    }

    const hash = await sha256(bytes);

    await env.DB.prepare(`
      INSERT INTO packages (
        slug, name, author, description, license, platform
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        name = excluded.name,
        author = excluded.author,
        description = excluded.description,
        license = excluded.license,
        platform = excluded.platform,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      slug,
      metadata.name,
      metadata.author,
      metadata.description || null,
      metadata.license || null,
      platform
    ).run();

    await env.DB.prepare(`
      INSERT OR IGNORE INTO package_versions (
        package_slug, version, source_id, sha256,
        file_size, metadata_json, status, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'published', CURRENT_TIMESTAMP)
    `).bind(
      slug,
      metadata.version,
      sourceRecord.id,
      hash,
      bytes.byteLength,
      JSON.stringify(metadata)
    ).run();

    const latest = await env.DB.prepare(`
      SELECT published_version FROM packages WHERE slug = ?
    `).bind(slug).first();

    if (
      !latest.published_version ||
      compareVersions(metadata.version, latest.published_version) > 0
    ) {
      await env.DB.prepare(`
        UPDATE packages
        SET published_version = ?, updated_at = CURRENT_TIMESTAMP
        WHERE slug = ?
      `).bind(metadata.version, slug).run();
    }

    await env.DB.prepare(`
      UPDATE sources SET last_scanned_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(sourceRecord.id).run();

    await env.DB.prepare(`
      UPDATE scan_jobs
      SET status = 'succeeded',
          updated_at = CURRENT_TIMESTAMP,
          last_error = NULL
      WHERE id = ?
    `).bind(job.id).run();

    return { job_id: job.id, status: "published", slug, version: metadata.version };
  } catch (error) {
    const message = String(error.message || "Scan failed.").slice(0, 500);

    await env.DB.prepare(`
      UPDATE scan_jobs
      SET status = 'failed',
          attempts = attempts + 1,
          last_error = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(message, job.id).run();

    return { job_id: job.id, status: "failed", error: message };
  }
}

async function runScanner(env) {
  const jobs = await env.DB.prepare(`
    SELECT id, source_id
    FROM scan_jobs
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT 5
  `).all();

  const results = [];
  for (const job of jobs.results || []) {
    await env.DB.prepare(`
      UPDATE scan_jobs
      SET status = 'running',
          attempts = attempts + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'queued'
    `).bind(job.id).run();

    results.push(await processJob(env, job));
  }

  return json({
    ok: true,
    processed: results.length,
    results
  });
}

async function handleDownload(env, slug, version) {
  const record = await env.DB.prepare(`
    SELECT s.source_url, pv.sha256
    FROM package_versions pv
    JOIN sources s ON s.id = pv.source_id
    WHERE pv.package_slug = ? AND pv.version = ?
      AND pv.status = 'published'
    LIMIT 1
  `).bind(slug, version).first();

  if (!record) return json({ error: "Published version not found." }, 404);

  try {
    const { bytes } = await fetchSource(record.source_url);
    if (record.sha256 && await sha256(bytes) !== record.sha256) {
      return json({ error: "Package integrity check failed." }, 502);
    }

    return new Response(bytes, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${slug}-${version}.lua"`,
        "cache-control": "public, max-age=60",
        "x-content-type-options": "nosniff"
      }
    });
  } catch {
    return json({ error: "Could not retrieve or verify package source." }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(request.headers.get("Origin"), env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    try {
      if (url.pathname.startsWith("/api/admin/")) {
        if (request.method !== "POST") {
          return json({ error: "Method not allowed." }, 405, headers);
        }
        if (!authorized(request, env)) {
          return json({ error: "Unauthorized." }, 401, headers);
        }
        if (url.pathname === "/api/admin/sources") {
          return await registerSource(request, env);
        }
        if (url.pathname === "/api/admin/scan") {
          return await runScanner(env);
        }
        return json({ error: "Not found." }, 404, headers);
      }

      if (request.method !== "GET") {
        return json({ error: "Method not allowed." }, 405, headers);
      }

      if (url.pathname === "/api/health") {
        return json({ ok: true, service: "enderpkg-api" }, 200, headers);
      }

      if (url.pathname === "/api/packages") {
        const result = await env.DB.prepare(`
          SELECT p.slug, p.name, p.author, p.description, p.license,
                 p.platform, p.published_version, p.updated_at
          FROM packages p
          WHERE EXISTS (
            SELECT 1 FROM package_versions pv
            WHERE pv.package_slug = p.slug AND pv.status = 'published'
          )
          ORDER BY p.name COLLATE NOCASE
          LIMIT 100
        `).all();
        return json({ packages: result.results || [] }, 200, headers);
      }

      const download = url.pathname.match(
        /^\/api\/packages\/([a-z0-9][a-z0-9-]*)\/([0-9]+\.[0-9]+\.[0-9]+)\/download$/
      );
      if (download) {
        const response = await handleDownload(env, download[1], download[2]);
        const merged = new Headers(response.headers);
        for (const [key, value] of Object.entries(headers)) merged.set(key, value);
        return new Response(response.body, { status: response.status, headers: merged });
      }

      const match = url.pathname.match(/^\/api\/packages\/([a-z0-9][a-z0-9-]*)$/);
      if (match) {
        const slug = match[1];
        const pkg = await env.DB.prepare(`
          SELECT slug, name, author, description, license, platform,
                 published_version, created_at, updated_at
          FROM packages WHERE slug = ?
        `).bind(slug).first();

        if (!pkg) return json({ error: "Package not found." }, 404, headers);

        const versions = await env.DB.prepare(`
          SELECT version, sha256, file_size, published_at
          FROM package_versions
          WHERE package_slug = ? AND status = 'published'
          ORDER BY published_at DESC
        `).bind(slug).all();

        return json({ package: pkg, versions: versions.results || [] }, 200, headers);
      }

      return json({ error: "Not found." }, 404, headers);
    } catch {
      return json({ error: "Internal server error." }, 500, headers);
    }
  }
};

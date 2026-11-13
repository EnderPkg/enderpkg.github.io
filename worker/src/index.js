
const MAX_SOURCE_SIZE = 256 * 1024;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigin = env.CORS_ORIGIN;

  return {
    "Access-Control-Allow-Origin":
      origin && origin === allowedOrigin ? origin : allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function validSlug(value) {
  return typeof value === "string" &&
    /^[a-z0-9][a-z0-9-]{1,49}$/.test(value);
}

function validVersion(value) {
  return typeof value === "string" &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(value);
}

async function handleRequest(request, env) {
  const headers = corsHeaders(request, env);
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method === "GET" && path === "/api/health") {
    return json({ status: "ok", service: "endpkg-api" }, 200, headers);
  }

  if (request.method === "GET" && path === "/api/packages") {
    const search = (url.searchParams.get("search") || "").trim();

    const result = search
      ? await env.DB.prepare(`
          SELECT slug, name, description, author, latest_version
          FROM packages
          WHERE name LIKE ? OR slug LIKE ? OR description LIKE ?
          ORDER BY name COLLATE NOCASE
          LIMIT 100
        `).bind(`%${search}%`, `%${search}%`, `%${search}%`).all()
      : await env.DB.prepare(`
          SELECT slug, name, description, author, latest_version
          FROM packages
          ORDER BY name COLLATE NOCASE
          LIMIT 100
        `).all();

    return json({ packages: result.results || [] }, 200, headers);
  }

  const downloadMatch = path.match(
    /^\/api\/packages\/([a-z0-9-]+)\/([0-9A-Za-z.+-]+)\/download$/
  );

  if (request.method === "GET" && downloadMatch) {
    const [, slug, version] = downloadMatch;

    const record = await env.DB.prepare(`
      SELECT v.download_key
      FROM package_versions v
      JOIN packages p ON p.id = v.package_id
      WHERE p.slug = ?
        AND v.version = ?
    `).bind(slug, version).first();

    if (!record) {
      return json({ error: "Package version not found" }, 404, headers);
    }

    const object = await env.PACKAGES_BUCKET.get(record.download_key);

    if (!object) {
      return json({ error: "Package file not found" }, 404, headers);
    }

    return new Response(object.body, {
      headers: {
        ...headers,
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}-${version}.lua"`,
        "Cache-Control": "public, max-age=300"
      }
    });
  }

  const packageMatch = path.match(/^\/api\/packages\/([a-z0-9-]+)$/);

  if (request.method === "GET" && packageMatch) {
    const slug = packageMatch[1];

    const pkg = await env.DB.prepare(`
      SELECT id, slug, name, description, author, latest_version,
             created_at, updated_at
      FROM packages
      WHERE slug = ?
    `).bind(slug).first();

    if (!pkg) {
      return json({ error: "Package not found" }, 404, headers);
    }

    const versions = await env.DB.prepare(`
      SELECT version, changelog, published_at
      FROM package_versions
      WHERE package_id = ?
      ORDER BY published_at DESC
    `).bind(pkg.id).all();

    return json({
      package: pkg,
      versions: versions.results || []
    }, 200, headers);
  }

  if (request.method === "POST" && path === "/api/submissions") {
    const contentType = request.headers.get("Content-Type") || "";

    if (!contentType.includes("application/json")) {
      return json({ error: "Content-Type must be application/json" }, 415, headers);
    }

    const declaredLength = Number(request.headers.get("Content-Length") || 0);

    if (declaredLength > MAX_SOURCE_SIZE + 16 * 1024) {
      return json({ error: "Request too large" }, 413, headers);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400, headers);
    }

    const { slug, name, description, author, version, source } = body || {};

    if (!validSlug(slug)) {
      return json({ error: "Invalid package slug" }, 400, headers);
    }

    if (!validVersion(version)) {
      return json({ error: "Invalid version. Use semantic versioning, e.g. 1.0.0" }, 400, headers);
    }

    if (
      typeof name !== "string" || name.trim().length < 2 || name.length > 80 ||
      typeof author !== "string" || author.trim().length < 2 || author.length > 80 ||
      typeof description !== "string" || description.length > 1000 ||
      typeof source !== "string" || source.length === 0
    ) {
      return json({ error: "Invalid or missing package fields" }, 400, headers);
    }

    if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_SIZE) {
      return json({ error: "Lua source exceeds 256 KiB" }, 413, headers);
    }

    const existing = await env.DB.prepare(`
      SELECT id FROM packages WHERE slug = ?
    `).bind(slug).first();

    if (existing) {
      const versionExists = await env.DB.prepare(`
        SELECT id FROM package_versions
        WHERE package_id = ? AND version = ?
      `).bind(existing.id, version).first();

      if (versionExists) {
        return json({ error: "This package version already exists" }, 409, headers);
      }
    }

    const downloadKey = `pending/${crypto.randomUUID()}.lua`;

    await env.PACKAGES_BUCKET.put(downloadKey, source, {
      httpMetadata: {
        contentType: "text/plain; charset=utf-8"
      }
    });

    try {
      await env.DB.prepare(`
        INSERT INTO submissions
          (slug, name, description, author, version, download_key, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `).bind(
        slug,
        name.trim(),
        description.trim(),
        author.trim(),
        version,
        downloadKey
      ).run();
    } catch (error) {
      await env.PACKAGES_BUCKET.delete(downloadKey);
      throw error;
    }

    return json({
      message: "Submission received",
      status: "pending"
    }, 201, headers);
  }

  return json({ error: "Not found" }, 404, headers);
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error("EndPkg API error:", error);
      return json(
        { error: "Internal server error" },
        500,
        corsHeaders(request, env)
      );
    }
  }
};
  

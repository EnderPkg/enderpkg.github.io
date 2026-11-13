const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

function corsHeaders(origin, allowedOrigin) {
  const headers = {};
  if (origin && allowedOrigin && origin === allowedOrigin) {
    headers["access-control-allow-origin"] = allowedOrigin;
    headers["vary"] = "Origin";
  }
  headers["access-control-allow-methods"] = "GET, OPTIONS";
  headers["access-control-allow-headers"] = "Content-Type";
  return headers;
}

function isAllowedSource(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;

  if (url.hostname === "raw.githubusercontent.com") {
    return url.pathname.split("/").filter(Boolean).length >= 4;
  }

  if (url.hostname === "github.com") {
    return url.pathname.includes("/raw/");
  }

  if (url.hostname === "pastebin.com") {
    return /^\/raw\/[A-Za-z0-9]+$/.test(url.pathname);
  }

  return false;
}

async function handleDownload(env, slug, version) {
  const record = await env.DB.prepare(`
    SELECT s.source_url, pv.sha256, pv.file_size
    FROM package_versions pv
    JOIN packages p ON p.slug = pv.package_slug
    JOIN sources s ON s.id = pv.source_id
    WHERE p.slug = ? AND pv.version = ? AND pv.status = 'published'
    LIMIT 1
  `).bind(slug, version).first();

  if (!record) return json({ error: "Published package version not found." }, 404);
  if (!isAllowedSource(record.source_url)) {
    return json({ error: "Package source is not allowed." }, 502);
  }

  let upstream;
  try {
    upstream = await fetch(record.source_url, {
      method: "GET",
      redirect: "manual",
      headers: { "user-agent": "EndPkg/0.1 (+https://enderpkg.github.io)" }
    });
  } catch {
    return json({ error: "Could not retrieve package source." }, 502);
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    return json({ error: "Source redirects are not accepted." }, 502);
  }
  if (!upstream.ok || !upstream.body) {
    return json({ error: "Upstream source returned an error." }, 502);
  }

  const declaredLength = Number(upstream.headers.get("content-length") || 0);
  const maxBytes = 2 * 1024 * 1024;
  if (declaredLength > maxBytes) {
    return json({ error: "Package exceeds the 2 MiB download limit." }, 413);
  }

  const content = await upstream.arrayBuffer();
  if (content.byteLength > maxBytes) {
    return json({ error: "Package exceeds the 2 MiB download limit." }, 413);
  }

  if (record.sha256) {
    const digest = await crypto.subtle.digest("SHA-256", content);
    const actual = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (actual.toLowerCase() !== record.sha256.toLowerCase()) {
      return json({ error: "Package integrity check failed." }, 502);
    }
  }

  return new Response(content, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${slug}-${version}.lua"`,
      "cache-control": "public, max-age=60",
      "x-content-type-options": "nosniff"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const headers = corsHeaders(origin, env.CORS_ORIGIN);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "GET") {
      return json({ error: "Method not allowed." }, 405, {
        ...headers,
        allow: "GET, OPTIONS"
      });
    }

    try {
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

      const downloadMatch = url.pathname.match(
        /^\/api\/packages\/([a-z0-9][a-z0-9-]*)\/([0-9]+\.[0-9]+\.[0-9]+)\/download$/
      );
      if (downloadMatch) {
        const response = await handleDownload(env, downloadMatch[1], downloadMatch[2]);
        const merged = new Headers(response.headers);
        for (const [key, value] of Object.entries(headers)) merged.set(key, value);
        return new Response(response.body, {
          status: response.status,
          headers: merged
        });
      }

      const packageMatch = url.pathname.match(
        /^\/api\/packages\/([a-z0-9][a-z0-9-]*)$/
      );
      if (packageMatch) {
        const slug = packageMatch[1];
        const pkg = await env.DB.prepare(`
          SELECT slug, name, author, description, license, platform,
                 published_version, created_at, updated_at
          FROM packages WHERE slug = ?
          AND EXISTS (
            SELECT 1 FROM package_versions pv
            WHERE pv.package_slug = packages.slug AND pv.status = 'published'
          )
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


-- EndPkg database schema
-- SQLite / Cloudflare D1

PRAGMA foreign_keys = ON;

-- Registered package sources (GitHub or Pastebin)
CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL
        CHECK (provider IN ('github', 'pastebin')),
    source_url TEXT NOT NULL UNIQUE,
    external_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 1
        CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_scanned_at TEXT
);

-- Main package registry
CREATE TABLE IF NOT EXISTS packages (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    author TEXT NOT NULL,
    description TEXT,
    license TEXT,
    platform TEXT NOT NULL DEFAULT 'cc-tweaked',
    published_version TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Every discovered or published package version
CREATE TABLE IF NOT EXISTS package_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package_slug TEXT NOT NULL,
    version TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    sha256 TEXT,
    file_size INTEGER,
    metadata_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'published', 'rejected')),
    rejection_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TEXT,

    FOREIGN KEY (package_slug)
        REFERENCES packages(slug) ON DELETE CASCADE,

    FOREIGN KEY (source_id)
        REFERENCES sources(id),

    UNIQUE (package_slug, version)
);

-- Scanner task queue
CREATE TABLE IF NOT EXISTS scan_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_run_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (source_id)
        REFERENCES sources(id) ON DELETE CASCADE
);

-- User reports about packages
CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package_slug TEXT NOT NULL,
    version TEXT,
    reason TEXT NOT NULL,
    details TEXT,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'reviewed', 'dismissed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (package_slug)
        REFERENCES packages(slug) ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_versions_package
    ON package_versions(package_slug);

CREATE INDEX IF NOT EXISTS idx_versions_status
    ON package_versions(status);

CREATE INDEX IF NOT EXISTS idx_scan_jobs_status
    ON scan_jobs(status, next_run_at);

CREATE INDEX IF NOT EXISTS idx_reports_status
    ON 
    reports(status);

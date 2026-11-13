
CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL,
    latest_version TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS package_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package_id INTEGER NOT NULL,
    version TEXT NOT NULL,
    download_key TEXT NOT NULL,
    changelog TEXT DEFAULT '',
    published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (package_id) REFERENCES packages(id),
    UNIQUE(package_id, version)
);

CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    author TEXT NOT NULL,
    version TEXT NOT NULL,
    download_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'approved', 'rejected')),
    submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_packages_slug
ON packages(slug);

CREATE INDEX IF NOT EXISTS idx_submissions_status
ON submissions(sta
  tus);

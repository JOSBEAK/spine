// Schema migrations. Each step is idempotent SQL and runs once, recorded in schema_version.
// The same SQL runs on hosted Postgres and on PGlite. Add new steps at the end; never edit old ones.

const MIGRATIONS = [
  {
    version: 1,
    sql: `
CREATE EXTENSION IF NOT EXISTS citext;
CREATE SEQUENCE IF NOT EXISTS sync_rev;

CREATE TABLE IF NOT EXISTS users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       citext NOT NULL UNIQUE,
  name        text NOT NULL DEFAULT '',
  pw_hash     text NOT NULL,
  prefs       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash    bytea PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  user_agent    text
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  key           text PRIMARY KEY,
  failures      int NOT NULL DEFAULT 0,
  window_start  timestamptz NOT NULL DEFAULT now()
);

-- Shared catalogue cache: a book is stored once no matter how many readers have it.
CREATE TABLE IF NOT EXISTS books (
  id          text PRIMARY KEY,
  title       text NOT NULL DEFAULT '',
  author      text NOT NULL DEFAULT '',
  year        text NOT NULL DEFAULT '',
  cover       int,
  kind        text NOT NULL DEFAULT 'book' CHECK (kind IN ('book', 'textbook')),
  access      text,
  subjects    text[] NOT NULL DEFAULT '{}',
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS library (
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id            text NOT NULL REFERENCES books(id),
  on_shelf           boolean NOT NULL DEFAULT false,
  status             text CHECK (status IN ('want', 'reading', 'finished', 'borrowed')),
  progress           real NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  position           jsonb,
  chapter_title      text,
  seconds            int NOT NULL DEFAULT 0,
  sessions           int NOT NULL DEFAULT 0,
  first_opened_at    timestamptz,
  last_opened_at     timestamptz,
  finished_at        timestamptz,
  client_updated_at  timestamptz NOT NULL,
  rev                bigint NOT NULL,
  PRIMARY KEY (user_id, book_id)
);
CREATE INDEX IF NOT EXISTS library_user_rev_idx ON library (user_id, rev);

CREATE TABLE IF NOT EXISTS highlights (
  id                 uuid PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id            text NOT NULL REFERENCES books(id),
  locator            jsonb NOT NULL DEFAULT '{}'::jsonb,
  text               text NOT NULL DEFAULT '',
  color              text,
  note               text NOT NULL DEFAULT '',
  deleted            boolean NOT NULL DEFAULT false,
  client_updated_at  timestamptz NOT NULL,
  rev                bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS highlights_user_rev_idx ON highlights (user_id, rev);
CREATE INDEX IF NOT EXISTS highlights_user_book_idx ON highlights (user_id, book_id) WHERE NOT deleted;

CREATE TABLE IF NOT EXISTS bookmarks (
  id                 uuid PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id            text NOT NULL REFERENCES books(id),
  locator            jsonb NOT NULL DEFAULT '{}'::jsonb,
  label              text NOT NULL DEFAULT '',
  deleted            boolean NOT NULL DEFAULT false,
  client_updated_at  timestamptz NOT NULL,
  rev                bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS bookmarks_user_rev_idx ON bookmarks (user_id, rev);
CREATE INDEX IF NOT EXISTS bookmarks_user_book_idx ON bookmarks (user_id, book_id) WHERE NOT deleted;

-- One row per sitting, not per page turn. A sitting is identified by (book, started_at), so a
-- client that resends a sitting (retry, or a longer version of one still in progress) updates it.
CREATE TABLE IF NOT EXISTS reading_sessions (
  id             bigserial PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id        text NOT NULL REFERENCES books(id),
  mode           text NOT NULL CHECK (mode IN ('text', 'scan', 'borrow', 'textbook', 'audio')),
  started_at     timestamptz NOT NULL,
  ended_at       timestamptz NOT NULL,
  seconds        int NOT NULL DEFAULT 0,
  from_progress  real,
  to_progress    real,
  pages          int,
  UNIQUE (user_id, book_id, started_at)
);
CREATE INDEX IF NOT EXISTS reading_sessions_user_at_idx ON reading_sessions (user_id, started_at DESC);

-- Raw events are pruned after 180 days; interests keep the long-term signal.
-- The unique index makes resent events (after a lost response) harmless.
CREATE TABLE IF NOT EXISTS events (
  id       bigserial PRIMARY KEY,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type     text NOT NULL CHECK (type IN ('view', 'search', 'shelf_add', 'shelf_remove', 'borrow_open', 'listen', 'finish', 'highlight', 'link')),
  book_id  text,
  at       timestamptz NOT NULL,
  data     jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS events_user_at_idx ON events (user_id, at DESC, type, (coalesce(book_id, '')));

CREATE TABLE IF NOT EXISTS interests (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key         text NOT NULL,
  score       real NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS linked_accounts (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      text NOT NULL CHECK (provider IN ('archive', 'openlibrary', 'goodreads', 'storygraph')),
  username      text,
  status        text NOT NULL DEFAULT 'connected',
  connected_at  timestamptz NOT NULL DEFAULT now(),
  last_sync_at  timestamptz,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, provider)
);

CREATE TABLE IF NOT EXISTS ol_cache (
  key         text PRIMARY KEY,
  body        jsonb NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ol_cache_fetched_idx ON ol_cache (fetched_at);
`,
  },
  {
    version: 2,
    sql: `
-- Who opened which book, once per reader per month. A reader is an account id, or for people
-- without an account a random id their browser made up (nothing personal). Rows older than
-- 13 months are pruned; the counts below keep the history.
CREATE TABLE IF NOT EXISTS monthly_readers (
  month    int  NOT NULL,             -- 202611 = November 2026 (UTC)
  book_id  text NOT NULL REFERENCES books(id),
  reader   uuid NOT NULL,
  PRIMARY KEY (month, book_id, reader)
);

-- Readers per book per month, bumped only when a new monthly_readers row lands,
-- so "most read" lists and per-book counts never have to count raw rows.
CREATE TABLE IF NOT EXISTS book_month_counts (
  month    int  NOT NULL,
  book_id  text NOT NULL REFERENCES books(id),
  readers  int  NOT NULL DEFAULT 0,
  PRIMARY KEY (month, book_id)
);
CREATE INDEX IF NOT EXISTS book_month_counts_top_idx ON book_month_counts (month, readers DESC);
CREATE INDEX IF NOT EXISTS book_month_counts_book_idx ON book_month_counts (book_id);
`,
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Runs pending migrations inside one transaction, holding a lock so parallel cold starts don't race. */
export async function migrate(driver) {
  await driver.tx(async (q) => {
    await q.query('SELECT pg_advisory_xact_lock(727274001)');
    await q.exec(`CREATE TABLE IF NOT EXISTS schema_version (
      version     int PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await q.query('SELECT coalesce(max(version), 0) AS v FROM schema_version');
    const current = Number(rows[0].v);
    for (const m of MIGRATIONS) {
      if (m.version <= current) continue;
      await q.exec(m.sql);
      await q.query('INSERT INTO schema_version (version) VALUES ($1) ON CONFLICT DO NOTHING', [m.version]);
    }
  });
}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildDelta } from './voteMath.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'data', 'votes.sqlite');

export function openDatabase(dbPath = process.env.VOTE_DB_PATH || DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  initDatabase(db);
  return db;
}

export function initDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS actors (
      rowid TEXT PRIMARY KEY,
      source_id TEXT,
      election_id TEXT,
      name TEXT NOT NULL,
      store_name TEXT,
      city TEXT,
      work_type TEXT,
      representative_work TEXT,
      representative_role TEXT,
      gender TEXT,
      age_group TEXT,
      acting_duration_months TEXT,
      intro TEXT,
      recommend TEXT,
      cover_url TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS crawl_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT 'scheduled',
      actor_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS vote_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
      rowid TEXT NOT NULL REFERENCES actors(rowid) ON DELETE CASCADE,
      captured_at TEXT NOT NULL,
      public_votes INTEGER NOT NULL,
      vip_votes INTEGER NOT NULL,
      UNIQUE(run_id, rowid)
    );

    CREATE TABLE IF NOT EXISTS vote_deltas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
      rowid TEXT NOT NULL REFERENCES actors(rowid) ON DELETE CASCADE,
      captured_at TEXT NOT NULL,
      previous_snapshot_id INTEGER NOT NULL REFERENCES vote_snapshots(id) ON DELETE CASCADE,
      minutes_since_previous REAL,
      public_delta INTEGER NOT NULL,
      vip_delta INTEGER NOT NULL,
      UNIQUE(run_id, rowid)
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_row_time ON vote_snapshots(rowid, captured_at);
    CREATE INDEX IF NOT EXISTS idx_snapshots_run ON vote_snapshots(run_id);
    CREATE INDEX IF NOT EXISTS idx_deltas_run ON vote_deltas(run_id);
    CREATE INDEX IF NOT EXISTS idx_deltas_row_time ON vote_deltas(rowid, captured_at);
  `);
}

export function beginCrawlRun(db, startedAt, reason = 'scheduled') {
  const result = db.prepare(`
    INSERT INTO crawl_runs (started_at, status, reason)
    VALUES (?, 'running', ?)
  `).run(startedAt, reason);
  return Number(result.lastInsertRowid);
}

export function markCrawlFailed(db, runId, completedAt, error) {
  db.prepare(`
    UPDATE crawl_runs
    SET completed_at = ?, status = 'failed', error_message = ?
    WHERE id = ?
  `).run(completedAt, String(error?.message || error || 'Unknown error'), runId);
}

export function saveSuccessfulCrawl(db, runId, capturedAt, actors) {
  const upsertActor = db.prepare(`
    INSERT INTO actors (
      rowid, source_id, election_id, name, store_name, city, work_type,
      representative_work, representative_role, gender, age_group,
      acting_duration_months, intro, recommend, cover_url, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(rowid) DO UPDATE SET
      source_id = excluded.source_id,
      election_id = excluded.election_id,
      name = excluded.name,
      store_name = excluded.store_name,
      city = excluded.city,
      work_type = excluded.work_type,
      representative_work = excluded.representative_work,
      representative_role = excluded.representative_role,
      gender = excluded.gender,
      age_group = excluded.age_group,
      acting_duration_months = excluded.acting_duration_months,
      intro = excluded.intro,
      recommend = excluded.recommend,
      cover_url = excluded.cover_url,
      updated_at = excluded.updated_at
  `);

  const previousSnapshot = db.prepare(`
    SELECT id, captured_at, public_votes, vip_votes
    FROM vote_snapshots
    WHERE rowid = ?
    ORDER BY captured_at DESC, id DESC
    LIMIT 1
  `);

  const insertSnapshot = db.prepare(`
    INSERT INTO vote_snapshots (run_id, rowid, captured_at, public_votes, vip_votes)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertDelta = db.prepare(`
    INSERT INTO vote_deltas (
      run_id, rowid, captured_at, previous_snapshot_id,
      minutes_since_previous, public_delta, vip_delta
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const markSuccess = db.prepare(`
    UPDATE crawl_runs
    SET completed_at = ?, status = 'success', actor_count = ?, error_message = NULL
    WHERE id = ?
  `);

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const actor of actors) {
      if (!actor.rowid) continue;
      upsertActor.run(
        actor.rowid,
        actor.sourceId,
        actor.electionId,
        actor.name,
        actor.storeName,
        actor.city,
        actor.workType,
        actor.representativeWork,
        actor.representativeRole,
        actor.gender,
        actor.ageGroup,
        actor.actingDurationMonths,
        actor.intro,
        actor.recommend,
        actor.coverUrl,
        capturedAt
      );

      const previous = previousSnapshot.get(actor.rowid);
      insertSnapshot.run(runId, actor.rowid, capturedAt, actor.publicVotes, actor.vipVotes);

      const delta = buildDelta(previous, actor, capturedAt);
      if (delta) {
        insertDelta.run(
          runId,
          actor.rowid,
          capturedAt,
          delta.previousSnapshotId,
          delta.minutesSincePrevious,
          delta.publicDelta,
          delta.vipDelta
        );
      }
    }

    markSuccess.run(capturedAt, actors.length, runId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getLatestSuccessfulRun(db) {
  return db.prepare(`
    SELECT *
    FROM crawl_runs
    WHERE status = 'success'
    ORDER BY completed_at DESC, id DESC
    LIMIT 1
  `).get();
}

export function getLatestRun(db) {
  return db.prepare(`
    SELECT *
    FROM crawl_runs
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `).get();
}

export function getActorCount(db) {
  return db.prepare('SELECT COUNT(*) AS count FROM actors').get().count;
}

export function getSummary(db, rangeHours = 24) {
  const latestRun = getLatestSuccessfulRun(db);
  const actorCount = getActorCount(db);
  if (!latestRun) {
    return {
      actorCount,
      latestRun: null,
      latestPublicGrowth: 0,
      latestVipGrowth: 0,
      rangePublicGrowth: 0,
      rangeVipGrowth: 0,
      topMover: null
    };
  }

  const latest = db.prepare(`
    SELECT
      COALESCE(SUM(public_delta), 0) AS publicGrowth,
      COALESCE(SUM(vip_delta), 0) AS vipGrowth
    FROM vote_deltas
    WHERE run_id = ?
  `).get(latestRun.id);

  const since = new Date(Date.now() - rangeHours * 3600000).toISOString();
  const range = db.prepare(`
    SELECT
      COALESCE(SUM(public_delta), 0) AS publicGrowth,
      COALESCE(SUM(vip_delta), 0) AS vipGrowth
    FROM vote_deltas
    WHERE captured_at >= ?
  `).get(since);

  const topMover = db.prepare(`
    SELECT
      a.rowid, a.election_id AS electionId, a.name, a.store_name AS storeName, a.city,
      d.public_delta AS publicDelta, d.vip_delta AS vipDelta,
      (d.public_delta + d.vip_delta) AS totalDelta
    FROM vote_deltas d
    JOIN actors a ON a.rowid = d.rowid
    WHERE d.run_id = ?
    ORDER BY totalDelta DESC, d.public_delta DESC, d.vip_delta DESC
    LIMIT 1
  `).get(latestRun.id) || null;

  return {
    actorCount,
    latestRun,
    latestPublicGrowth: latest.publicGrowth,
    latestVipGrowth: latest.vipGrowth,
    rangePublicGrowth: range.publicGrowth,
    rangeVipGrowth: range.vipGrowth,
    topMover
  };
}

export function getLatestDeltas(db, { search = '', metric = 'both', limit = 100 } = {}) {
  const latestRun = getLatestSuccessfulRun(db);
  if (!latestRun) return { latestRun: null, rows: [] };

  const normalizedMetric = ['public', 'vip', 'both'].includes(metric) ? metric : 'both';
  const orderExpression = normalizedMetric === 'public'
    ? 'COALESCE(d.public_delta, -999999999)'
    : normalizedMetric === 'vip'
      ? 'COALESCE(d.vip_delta, -999999999)'
      : 'COALESCE(d.public_delta, -999999999) + COALESCE(d.vip_delta, -999999999)';

  const cleanLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), 500);
  const like = `%${search.toLowerCase()}%`;

  const rows = db.prepare(`
    SELECT
      a.rowid,
      a.election_id AS electionId,
      a.name,
      a.store_name AS storeName,
      a.city,
      a.work_type AS workType,
      a.representative_work AS representativeWork,
      a.representative_role AS representativeRole,
      a.gender,
      a.age_group AS ageGroup,
      a.acting_duration_months AS actingDurationMonths,
      a.intro,
      a.recommend,
      a.cover_url AS coverUrl,
      s.public_votes AS publicVotes,
      s.vip_votes AS vipVotes,
      d.public_delta AS publicDelta,
      d.vip_delta AS vipDelta,
      d.minutes_since_previous AS minutesSincePrevious,
      d.previous_snapshot_id AS previousSnapshotId
    FROM vote_snapshots s
    JOIN actors a ON a.rowid = s.rowid
    LEFT JOIN vote_deltas d ON d.run_id = s.run_id AND d.rowid = s.rowid
    WHERE s.run_id = ?
      AND (
        ? = ''
        OR lower(a.name) LIKE ?
        OR lower(a.election_id) LIKE ?
        OR lower(a.store_name) LIKE ?
        OR lower(a.city) LIKE ?
      )
    ORDER BY
      CASE WHEN d.previous_snapshot_id IS NULL THEN 1 ELSE 0 END ASC,
      ${orderExpression} DESC,
      s.public_votes DESC,
      s.vip_votes DESC
    LIMIT ?
  `).all(latestRun.id, search, like, like, like, like, cleanLimit);

  return { latestRun, rows };
}

export function getVoteRankings(db, { sort = 'vip', limit = 50 } = {}) {
  const latestRun = getLatestSuccessfulRun(db);
  if (!latestRun) return { latestRun: null, sort: normalizeRankingSort(sort), rows: [] };

  const normalizedSort = normalizeRankingSort(sort);
  const orderExpression = normalizedSort === 'public'
    ? 's.public_votes'
    : normalizedSort === 'final'
      ? '(s.vip_votes * 10 + s.public_votes)'
      : 's.vip_votes';
  const cleanLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100);

  const rows = db.prepare(`
    SELECT
      a.rowid,
      a.election_id AS electionId,
      a.name,
      a.store_name AS storeName,
      a.city,
      a.representative_work AS representativeWork,
      a.representative_role AS representativeRole,
      a.cover_url AS coverUrl,
      s.public_votes AS publicVotes,
      s.vip_votes AS vipVotes,
      (s.vip_votes * 10 + s.public_votes) AS finalVotes
    FROM vote_snapshots s
    JOIN actors a ON a.rowid = s.rowid
    WHERE s.run_id = ?
    ORDER BY
      ${orderExpression} DESC,
      s.vip_votes DESC,
      s.public_votes DESC,
      a.election_id ASC,
      a.name ASC
    LIMIT ?
  `).all(latestRun.id, cleanLimit);

  return { latestRun, sort: normalizedSort, rows };
}

function normalizeRankingSort(sort) {
  return ['vip', 'public', 'final'].includes(sort) ? sort : 'vip';
}

export function getTrends(db, { rowids = [], rangeHours = 24 } = {}) {
  let selectedRowids = rowids.filter(Boolean);

  if (selectedRowids.length === 0) {
    const latest = getLatestDeltas(db, { limit: 5 });
    selectedRowids = latest.rows.slice(0, 5).map((row) => row.rowid);
  }

  selectedRowids = selectedRowids.slice(0, 8);
  if (selectedRowids.length === 0) return { actors: [], series: [] };

  const since = new Date(Date.now() - rangeHours * 3600000).toISOString();
  const placeholders = selectedRowids.map(() => '?').join(', ');

  const actors = db.prepare(`
    SELECT rowid, election_id AS electionId, name, store_name AS storeName, city
    FROM actors
    WHERE rowid IN (${placeholders})
  `).all(...selectedRowids);

  const points = db.prepare(`
    SELECT
      s.rowid,
      s.captured_at AS capturedAt,
      s.public_votes AS publicVotes,
      s.vip_votes AS vipVotes,
      d.public_delta AS publicDelta,
      d.vip_delta AS vipDelta
    FROM vote_snapshots s
    LEFT JOIN vote_deltas d ON d.run_id = s.run_id AND d.rowid = s.rowid
    WHERE s.rowid IN (${placeholders})
      AND s.captured_at >= ?
    ORDER BY s.captured_at ASC
  `).all(...selectedRowids, since);

  return {
    actors,
    series: selectedRowids.map((rowid) => ({
      rowid,
      points: points.filter((point) => point.rowid === rowid)
    }))
  };
}


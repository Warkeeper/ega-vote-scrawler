import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { beginCrawlRun, getLatestDeltas, getVoteRankings, initDatabase, saveSuccessfulCrawl } from '../server/db.js';

function createMemoryDb() {
  const db = new DatabaseSync(':memory:');
  initDatabase(db);
  return db;
}

function actor(overrides = {}) {
  return {
    rowid: 'row-1',
    sourceId: 'source-1',
    electionId: 'NO-1',
    name: 'Actor One',
    storeName: 'Store',
    city: 'City',
    workType: '',
    representativeWork: 'Work',
    representativeRole: 'Role',
    gender: '',
    ageGroup: '',
    actingDurationMonths: '',
    intro: '',
    recommend: '',
    coverUrl: '',
    publicVotes: 100,
    vipVotes: 10,
    ...overrides
  };
}

test('saveSuccessfulCrawl creates deltas against the previous successful snapshot', () => {
  const db = createMemoryDb();

  const run1 = beginCrawlRun(db, '2026-07-01T00:00:00.000Z', 'test');
  saveSuccessfulCrawl(db, run1, '2026-07-01T00:00:00.000Z', [actor()]);

  const run2 = beginCrawlRun(db, '2026-07-01T01:00:00.000Z', 'test');
  saveSuccessfulCrawl(db, run2, '2026-07-01T01:00:00.000Z', [actor({ publicVotes: 112, vipVotes: 8 })]);

  const latest = getLatestDeltas(db);
  assert.equal(latest.rows.length, 1);
  assert.equal(latest.rows[0].publicDelta, 12);
  assert.equal(latest.rows[0].vipDelta, -2);
  assert.equal(latest.rows[0].minutesSincePrevious, 60);
});

test('new actors are returned without a delta until a previous snapshot exists', () => {
  const db = createMemoryDb();
  const run = beginCrawlRun(db, '2026-07-01T00:00:00.000Z', 'test');
  saveSuccessfulCrawl(db, run, '2026-07-01T00:00:00.000Z', [actor()]);

  const latest = getLatestDeltas(db);
  assert.equal(latest.rows.length, 1);
  assert.equal(latest.rows[0].publicDelta, null);
  assert.equal(latest.rows[0].previousSnapshotId, null);
});
test('getVoteRankings returns top actors by VIP, public, and final votes', () => {
  const db = createMemoryDb();
  const run = beginCrawlRun(db, '2026-07-01T00:00:00.000Z', 'test');
  saveSuccessfulCrawl(db, run, '2026-07-01T00:00:00.000Z', [
    actor({ rowid: 'row-a', electionId: 'A', name: 'Actor A', publicVotes: 100, vipVotes: 10 }),
    actor({ rowid: 'row-b', electionId: 'B', name: 'Actor B', publicVotes: 50, vipVotes: 20 }),
    actor({ rowid: 'row-c', electionId: 'C', name: 'Actor C', publicVotes: 500, vipVotes: 1 })
  ]);

  const vipRanking = getVoteRankings(db, { sort: 'vip', limit: 2 });
  assert.deepEqual(vipRanking.rows.map((row) => row.rowid), ['row-b', 'row-a']);

  const publicRanking = getVoteRankings(db, { sort: 'public', limit: 2 });
  assert.deepEqual(publicRanking.rows.map((row) => row.rowid), ['row-c', 'row-a']);

  const finalRanking = getVoteRankings(db, { sort: 'final', limit: 2 });
  assert.deepEqual(finalRanking.rows.map((row) => row.rowid), ['row-c', 'row-b']);
  assert.equal(finalRanking.rows[0].finalVotes, 510);
});

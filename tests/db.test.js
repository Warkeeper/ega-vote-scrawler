import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { beginCrawlRun, getLatestDeltas, getSummary, getVoteRankings, initDatabase, saveSuccessfulCrawl } from '../server/db.js';

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
  const realDateNow = Date.now;
  Date.now = () => new Date('2026-07-01T02:00:00.000Z').getTime();

  try {
    const run1 = beginCrawlRun(db, '2026-07-01T00:00:00.000Z', 'test');
    saveSuccessfulCrawl(db, run1, '2026-07-01T00:00:00.000Z', [actor()]);

    const run2 = beginCrawlRun(db, '2026-07-01T01:00:00.000Z', 'test');
    saveSuccessfulCrawl(db, run2, '2026-07-01T01:00:00.000Z', [actor({ publicVotes: 112, vipVotes: 8 })]);

    const latest = getLatestDeltas(db);
    assert.equal(latest.rows.length, 1);
    assert.equal(latest.rows[0].publicDelta, 12);
    assert.equal(latest.rows[0].vipDelta, -2);
    assert.equal(latest.rows[0].minutesSincePrevious, 60);
  } finally {
    Date.now = realDateNow;
  }
});

test('new actors are returned with zero range growth until a previous snapshot exists', () => {
  const db = createMemoryDb();
  const run = beginCrawlRun(db, '2026-07-01T00:00:00.000Z', 'test');
  saveSuccessfulCrawl(db, run, '2026-07-01T00:00:00.000Z', [actor()]);

  const latest = getLatestDeltas(db);
  assert.equal(latest.rows.length, 1);
  assert.equal(latest.rows[0].publicDelta, 0);
  assert.equal(latest.rows[0].previousSnapshotId, null);
});

test('range filters summary and delta leaderboard to cumulative growth within the window', () => {
  const db = createMemoryDb();
  const realDateNow = Date.now;
  Date.now = () => new Date('2026-07-02T12:00:00.000Z').getTime();

  try {
    const run1 = beginCrawlRun(db, '2026-07-02T00:00:00.000Z', 'test');
    saveSuccessfulCrawl(db, run1, '2026-07-02T00:00:00.000Z', [
      actor({ rowid: 'row-a', electionId: 'A', name: 'Actor A', publicVotes: 100, vipVotes: 10 }),
      actor({ rowid: 'row-b', electionId: 'B', name: 'Actor B', publicVotes: 100, vipVotes: 10 })
    ]);

    const run2 = beginCrawlRun(db, '2026-07-02T05:00:00.000Z', 'test');
    saveSuccessfulCrawl(db, run2, '2026-07-02T05:00:00.000Z', [
      actor({ rowid: 'row-a', electionId: 'A', name: 'Actor A', publicVotes: 110, vipVotes: 12 }),
      actor({ rowid: 'row-b', electionId: 'B', name: 'Actor B', publicVotes: 130, vipVotes: 20 })
    ]);

    const run3 = beginCrawlRun(db, '2026-07-02T08:00:00.000Z', 'test');
    saveSuccessfulCrawl(db, run3, '2026-07-02T08:00:00.000Z', [
      actor({ rowid: 'row-a', electionId: 'A', name: 'Actor A', publicVotes: 120, vipVotes: 15 }),
      actor({ rowid: 'row-b', electionId: 'B', name: 'Actor B', publicVotes: 132, vipVotes: 21 })
    ]);

    const run4 = beginCrawlRun(db, '2026-07-02T11:00:00.000Z', 'test');
    saveSuccessfulCrawl(db, run4, '2026-07-02T11:00:00.000Z', [
      actor({ rowid: 'row-a', electionId: 'A', name: 'Actor A', publicVotes: 125, vipVotes: 15 }),
      actor({ rowid: 'row-b', electionId: 'B', name: 'Actor B', publicVotes: 133, vipVotes: 22 })
    ]);

    const summary = getSummary(db, 6);
    assert.equal(summary.rangePublicGrowth, 18);
    assert.equal(summary.rangeVipGrowth, 5);
    assert.equal(summary.latestPublicGrowth, 6);
    assert.equal(summary.topMover.rowid, 'row-a');
    assert.equal(summary.topMover.totalDelta, 18);

    const latest = getLatestDeltas(db, { metric: 'public', rangeHours: 6 });
    assert.deepEqual(latest.rows.map((row) => row.rowid), ['row-a', 'row-b']);
    assert.equal(latest.rows[0].publicDelta, 15);
    assert.equal(latest.rows[0].vipDelta, 3);
    assert.equal(latest.rows[0].publicVotes, 125);
    assert.equal(latest.rows[0].minutesSincePrevious, 180);
  } finally {
    Date.now = realDateNow;
  }
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

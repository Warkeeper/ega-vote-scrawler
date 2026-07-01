import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIELD_IDS, extractCoverUrl, normalizeActor, parseVoteNumber, safeText } from '../server/fields.js';

test('safeText extracts names from Mingdao relation arrays', () => {
  const value = JSON.stringify([{ sid: 'abc', name: 'Lin Lin', sourcevalue: '{"nested":true}' }]);
  assert.equal(safeText(value), 'Lin Lin');
});

test('extractCoverUrl finds attachment URLs', () => {
  const value = JSON.stringify([{ thumbnail_full_path: 'https://example.com/thumb.jpg' }]);
  assert.equal(extractCoverUrl(value), 'https://example.com/thumb.jpg');
});

test('parseVoteNumber treats empty and invalid values as zero', () => {
  assert.equal(parseVoteNumber(''), 0);
  assert.equal(parseVoteNumber(null), 0);
  assert.equal(parseVoteNumber('1,204'), 1204);
});

test('normalizeActor preserves election id as text and parses vote fields', () => {
  const row = {
    _id: 'source-1',
    rowid: 'row-1',
    [FIELD_IDS.title]: 'Actor A',
    [FIELD_IDS.electionId]: '02425580',
    [FIELD_IDS.storeName]: 'Store A',
    [FIELD_IDS.city]: 'City A',
    [FIELD_IDS.repWork]: 'Work A',
    [FIELD_IDS.repRole]: 'Role A',
    [FIELD_IDS.votesMass]: '204',
    [FIELD_IDS.votesVip]: ''
  };

  const actor = normalizeActor(row);
  assert.equal(actor.electionId, '02425580');
  assert.equal(actor.publicVotes, 204);
  assert.equal(actor.vipVotes, 0);
});

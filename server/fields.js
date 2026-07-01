export const FIELD_IDS = Object.freeze({
  relation: '65b76ee9187d10482b6c52d0',
  electionId: '65b76ee9187d10482b6c52d2',
  title: '65b76ee9187d10482b6c52d3',
  storeName: '65b76ee9187d10482b6c52d4',
  workType: '65bc973baf402a407f0f4d68',
  city: '6849a6981b12e25212c96a21',
  actingDuration: '6849a6981b12e25212c96a22',
  ageGroup: '65b78232df24d232f18cb112',
  gender: '65b78232df24d232f18cb113',
  actorIntro: '65b78232df24d232f18cb111',
  recommend: '65b78232df24d232f18cb117',
  repWork: '65b78232df24d232f18cb114',
  repRole: '65b78232df24d232f18cb115',
  cover: '65b78232df24d232f18cb11a',
  votesVip: '69f6f791765e479ba3d56f76',
  votesMass: '69f6f706765e479ba3d56f2c',
  votesJudge: '642a535e49079795b9a67012'
});

const TEXT_KEYS = [
  'name',
  'value',
  'title',
  'fullname',
  'sourcevalue',
  'departmentName',
  'original_file_full_path'
];

const IMAGE_KEYS = [
  'large_thumbnail_full_path',
  'thumbnail_full_path',
  'original_file_full_path',
  'preview_url',
  'DownloadUrl'
];

export function parseJsonish(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function safeText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  const parsed = parseJsonish(value);
  if (typeof parsed === 'string') return parsed;

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const text = safeTextFromObject(item);
      if (text) return text;
    }
    return '';
  }

  if (typeof parsed === 'object' && parsed !== null) {
    return safeTextFromObject(parsed);
  }

  return String(parsed);
}

function safeTextFromObject(item) {
  if (!item || typeof item !== 'object') return '';

  for (const key of TEXT_KEYS) {
    if (typeof item[key] === 'string' && item[key].trim()) return item[key].trim();
  }

  for (const [key, value] of Object.entries(item)) {
    if (key === 'rowid' || key === 'sid') continue;
    if (typeof value === 'string' && value.trim() && value.length < 80) return value.trim();
  }

  return '';
}

export function extractCoverUrl(value) {
  const parsed = parseJsonish(value);
  const candidates = Array.isArray(parsed) ? parsed : [parsed];

  for (const item of candidates) {
    if (!item || typeof item !== 'object') continue;
    for (const key of IMAGE_KEYS) {
      if (typeof item[key] === 'string' && item[key].startsWith('http')) return item[key];
    }
  }

  if (typeof value === 'string' && value.startsWith('http')) return value;
  return '';
}

export function parseVoteNumber(value) {
  const text = safeText(value).replace(/,/g, '').trim();
  if (!text) return 0;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeActor(row) {
  const name = safeText(row[FIELD_IDS.title]) || safeText(row[FIELD_IDS.relation]) || 'Unknown actor';

  return {
    rowid: String(row.rowid || ''),
    sourceId: String(row._id || ''),
    electionId: safeText(row[FIELD_IDS.electionId]),
    name,
    storeName: safeText(row[FIELD_IDS.storeName]),
    city: safeText(row[FIELD_IDS.city]),
    workType: safeText(row[FIELD_IDS.workType]),
    representativeWork: safeText(row[FIELD_IDS.repWork]),
    representativeRole: safeText(row[FIELD_IDS.repRole]),
    gender: safeText(row[FIELD_IDS.gender]),
    ageGroup: safeText(row[FIELD_IDS.ageGroup]),
    actingDurationMonths: safeText(row[FIELD_IDS.actingDuration]).replace(/[^0-9.]/g, ''),
    intro: safeText(row[FIELD_IDS.actorIntro]),
    recommend: safeText(row[FIELD_IDS.recommend]),
    coverUrl: extractCoverUrl(row[FIELD_IDS.cover]),
    publicVotes: parseVoteNumber(row[FIELD_IDS.votesMass]),
    vipVotes: parseVoteNumber(row[FIELD_IDS.votesVip])
  };
}

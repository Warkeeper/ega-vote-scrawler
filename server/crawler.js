import { beginCrawlRun, markCrawlFailed, saveSuccessfulCrawl } from './db.js';
import { normalizeActor } from './fields.js';

const FETCH_URL = 'https://chinaega.com/vote/actors/vote_mingdao.php';

export class VoteCrawler {
  constructor(db) {
    this.db = db;
    this.isCrawling = false;
    this.lastError = null;
  }

  async crawl(reason = 'scheduled') {
    if (this.isCrawling) {
      return { skipped: true, reason: 'crawl already running' };
    }

    this.isCrawling = true;
    const startedAt = new Date().toISOString();
    const runId = beginCrawlRun(this.db, startedAt, reason);

    try {
      const rows = await fetchVoteRows();
      const actors = rows.map(normalizeActor).filter((actor) => actor.rowid);
      const capturedAt = new Date().toISOString();
      saveSuccessfulCrawl(this.db, runId, capturedAt, actors);
      this.lastError = null;
      return { runId, actorCount: actors.length, capturedAt };
    } catch (error) {
      this.lastError = String(error?.message || error);
      markCrawlFailed(this.db, runId, new Date().toISOString(), error);
      throw error;
    } finally {
      this.isCrawling = false;
    }
  }
}

export async function fetchVoteRows() {
  const response = await fetch(FETCH_URL, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'content-type': 'application/json',
      origin: 'https://chinaega.com',
      referer: 'https://chinaega.com/vote/actors/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0'
    },
    body: JSON.stringify({ action: 'fetchWorks' })
  });

  if (!response.ok) throw new Error(`EGA fetch failed with HTTP ${response.status}`);

  const json = await response.json();
  if (json.error_code && json.error_code !== 1) {
    throw new Error(json.error_msg || 'EGA fetch returned an error');
  }

  if (!json.data || !Array.isArray(json.data.rows)) {
    throw new Error('EGA fetch returned an unexpected payload');
  }

  return json.data.rows;
}

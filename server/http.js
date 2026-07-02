import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getActorCount, getLatestDeltas, getLatestRun, getSummary, getTrends, getVoteRankings } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8'
};

export async function handleRequest(req, res, { db, crawler, scheduler }) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url, { db, crawler, scheduler });
      return;
    }

    serveStatic(req, res, url);
  } catch (error) {
    console.error('[http] request failed:', error);
    sendJson(res, 500, { error: String(error?.message || error) });
  }
}

async function handleApi(req, res, url, { db, crawler, scheduler }) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (url.pathname === '/api/status') {
    sendJson(res, 200, {
      isCrawling: crawler.isCrawling,
      nextRunAt: scheduler.nextRunAt,
      lastError: crawler.lastError,
      actorCount: getActorCount(db),
      latestRun: getLatestRun(db)
    });
    return;
  }

  if (url.pathname === '/api/summary') {
    sendJson(res, 200, getSummary(db, numberParam(url, 'rangeHours', 24)));
    return;
  }

  if (url.pathname === '/api/deltas') {
    sendJson(res, 200, getLatestDeltas(db, {
      search: url.searchParams.get('search') || '',
      metric: url.searchParams.get('metric') || 'both',
      rangeHours: numberParam(url, 'rangeHours', 24),
      limit: numberParam(url, 'limit', 100)
    }));
    return;
  }

  if (url.pathname === '/api/rankings') {
    sendJson(res, 200, getVoteRankings(db, {
      sort: url.searchParams.get('sort') || 'vip',
      limit: numberParam(url, 'limit', 50)
    }));
    return;
  }
  if (url.pathname === '/api/trends') {
    const rowids = (url.searchParams.get('rowids') || '').split(',').map((value) => value.trim()).filter(Boolean);
    sendJson(res, 200, getTrends(db, {
      rowids,
      rangeHours: numberParam(url, 'rangeHours', 24)
    }));
    return;
  }

  sendJson(res, 404, { error: 'API route not found' });
}

function numberParam(url, key, fallback) {
  const parsed = Number.parseInt(url.searchParams.get(key) || '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  let filePath = path.normalize(path.join(DIST_DIR, pathname));
  if (!filePath.startsWith(DIST_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    sendText(res, 503, 'Frontend is not built. Run npm run build before node server/index.js.');
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, {
    'content-type': MIME_TYPES[ext] || 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable'
  });
  fs.createReadStream(filePath).pipe(res);
}

export function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

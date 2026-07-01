import http from 'node:http';
import { openDatabase } from './db.js';
import { VoteCrawler } from './crawler.js';
import { HourlyScheduler } from './scheduler.js';
import { handleRequest } from './http.js';

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';

const db = openDatabase();
const crawler = new VoteCrawler(db);
const scheduler = new HourlyScheduler(crawler);

const server = http.createServer((req, res) => {
  void handleRequest(req, res, { db, crawler, scheduler });
});

server.listen(PORT, HOST, () => {
  console.log(`EGA Vote Monitor listening at http://${HOST}:${PORT}`);
  scheduler.start();
  void crawler.crawl('startup').catch((error) => {
    console.error('[crawler] startup crawl failed:', error);
  });
});

function shutdown() {
  scheduler.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

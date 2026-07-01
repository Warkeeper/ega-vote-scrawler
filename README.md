# EGA Vote Hourly Monitor

Local hourly monitor for the EGA actor voting page. The service fetches the public `fetchWorks` endpoint, stores vote snapshots in SQLite, and serves a dashboard with current votes, latest interval deltas, and trend charts.

## Commands

```powershell
npm install
npm run build
npm start
```

`npm start` builds the React app, starts the Node HTTP server, runs one startup crawl, then schedules future crawls on the next whole hour and every hour after that.

Default URL: `http://127.0.0.1:3000`

When deploying under an Nginx subpath such as `/ega-vote/`, build with:

```bash
BASE_PATH=/ega-vote/ npm run build
```

The generated HTML will reference `/ega-vote/assets/...`, and the frontend will call `/ega-vote/api/...`.

If port 3000 is busy:

```powershell
$env:PORT='3001'; node server/index.js
```

## Data

SQLite data is stored at `data/votes.sqlite` by default. Set `VOTE_DB_PATH` to use another file.

The first successful crawl creates the baseline snapshot. Hourly growth values appear after a second successful snapshot exists for the same actor.

## API

- `GET /api/status`
- `GET /api/summary?rangeHours=24`
- `GET /api/deltas?search=&metric=both&limit=100`
- `GET /api/trends?rowids=<rowid,rowid>&rangeHours=24`

## Verification

```powershell
npm test
npm run build
```
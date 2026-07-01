import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const METRIC_OPTIONS = [
  { label: 'Both', value: 'both' },
  { label: 'Public', value: 'public' },
  { label: 'VIP', value: 'vip' }
];

const RANGE_OPTIONS = [
  { label: '6H', value: 6 },
  { label: '24H', value: 24 },
  { label: '7D', value: 168 }
];


const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, '');
const API_PREFIX = baseUrl === '' || baseUrl === '/' ? '' : baseUrl;

function apiPath(path) {
  return `${API_PREFIX}${path}`;
}

function App() {
  const [status, setStatus] = useState(null);
  const [summary, setSummary] = useState(null);
  const [deltas, setDeltas] = useState({ latestRun: null, rows: [] });
  const [trends, setTrends] = useState({ actors: [], series: [] });
  const [metric, setMetric] = useState('both');
  const [rangeHours, setRangeHours] = useState(24);
  const [search, setSearch] = useState('');
  const [selectedRowid, setSelectedRowid] = useState('');
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const query = new URLSearchParams({ metric, search, limit: '100' });
        const [statusRes, summaryRes, deltasRes] = await Promise.all([
          fetch(apiPath('/api/status'), { signal: controller.signal }),
          fetch(apiPath(`/api/summary?rangeHours=${rangeHours}`), { signal: controller.signal }),
          fetch(apiPath(`/api/deltas?${query}`), { signal: controller.signal })
        ]);

        if (!statusRes.ok || !summaryRes.ok || !deltasRes.ok) throw new Error('Dashboard API request failed');

        const [statusData, summaryData, deltasData] = await Promise.all([
          statusRes.json(),
          summaryRes.json(),
          deltasRes.json()
        ]);

        setStatus(statusData);
        setSummary(summaryData);
        setDeltas(deltasData);
        setError('');

        if (!selectedRowid && deltasData.rows.length > 0) {
          setSelectedRowid(deltasData.rows[0].rowid);
        }
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message || 'Failed to load dashboard data');
      }
    };

    void load();
    const timer = setInterval(load, 30000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [metric, search, rangeHours]);

  useEffect(() => {
    const controller = new AbortController();
    const rowids = selectedRowid || deltas.rows.slice(0, 5).map((row) => row.rowid).join(',');
    if (!rowids) {
      setTrends({ actors: [], series: [] });
      return () => controller.abort();
    }

    fetch(apiPath(`/api/trends?rangeHours=${rangeHours}&rowids=${encodeURIComponent(rowids)}`), { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('Trend request failed');
        return res.json();
      })
      .then(setTrends)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message || 'Failed to load trends');
      });

    return () => controller.abort();
  }, [selectedRowid, rangeHours, deltas.rows]);

  const selectedActor = useMemo(
    () => deltas.rows.find((row) => row.rowid === selectedRowid) || deltas.rows[0] || null,
    [deltas.rows, selectedRowid]
  );

  const nextRunLabel = formatCountdown(status?.nextRunAt, now);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">E</div>
          <div>
            <div className="brand-title">EGA</div>
            <div className="brand-subtitle">Vote Monitor</div>
          </div>
        </div>
        <nav className="nav-list" aria-label="Dashboard sections">
          <span className="nav-item active">Overview</span>
          <span className="nav-item">Hourly Growth</span>
          <span className="nav-item">Trends</span>
          <span className="nav-item">Actors</span>
        </nav>
        <div className="sidebar-note">
          <span className="status-dot" data-state={status?.isCrawling ? 'busy' : error ? 'error' : 'ok'} />
          <span>{status?.isCrawling ? 'Crawling now' : error ? 'API warning' : 'Service online'}</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>EGA Vote Monitor</h1>
            <p>Hourly public and VIP vote growth tracker</p>
          </div>
          <div className="topbar-status">
            <StatusChip label="Last crawl" value={formatDateTime(status?.latestRun?.completed_at)} />
            <StatusChip label="Next crawl" value={nextRunLabel} />
            <StatusChip label="Actors" value={formatNumber(status?.actorCount || 0)} />
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}
        {status?.latestRun?.status === 'failed' ? (
          <div className="error-banner">Last crawl failed: {status.latestRun.error_message}</div>
        ) : null}

        <section className="summary-grid" aria-label="Summary metrics">
          <MetricCard label="Total actors" value={summary?.actorCount || 0} accent="neutral" />
          <MetricCard label="Public growth" value={summary?.latestPublicGrowth || 0} accent="public" prefix="+" />
          <MetricCard label="VIP growth" value={summary?.latestVipGrowth || 0} accent="vip" prefix="+" />
          <MetricCard
            label="Top mover"
            value={summary?.topMover?.name || 'Waiting'}
            detail={summary?.topMover ? `+${summary.topMover.totalDelta} total` : 'Need two snapshots'}
            accent="positive"
          />
        </section>

        <section className="controls-row" aria-label="Dashboard controls">
          <div className="search-box">
            <span>Search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Actor, NO, store, city"
            />
          </div>
          <SegmentedControl label="Metric" options={METRIC_OPTIONS} value={metric} onChange={setMetric} />
          <SegmentedControl label="Range" options={RANGE_OPTIONS} value={rangeHours} onChange={setRangeHours} />
        </section>

        <section className="dashboard-grid">
          <div className="panel leaderboard-panel">
            <PanelHeader title="Hourly Growth Leaderboard" meta={intervalLabel(deltas.rows[0])} />
            <GrowthTable rows={deltas.rows} selectedRowid={selectedActor?.rowid} onSelect={setSelectedRowid} />
          </div>

          <div className="panel trend-panel">
            <PanelHeader title="Vote Trend" meta={`Last ${rangeHours === 168 ? '7 days' : `${rangeHours} hours`}`} />
            <LineChart trends={trends} metric={metric} />
          </div>

          <div className="panel bar-panel">
            <PanelHeader title="Top Hourly Gainers" meta="Latest interval" />
            <BarChart rows={deltas.rows.slice(0, 8)} metric={metric} />
          </div>

          <ActorDetail actor={selectedActor} />
        </section>
      </main>
    </div>
  );
}

function StatusChip({ label, value }) {
  return (
    <div className="status-chip">
      <span>{label}</span>
      <strong>{value || 'Waiting'}</strong>
    </div>
  );
}

function MetricCard({ label, value, detail, accent, prefix = '' }) {
  const numeric = typeof value === 'number';
  const display = numeric ? `${prefix}${formatNumber(value)}` : value;
  return (
    <article className="metric-card" data-accent={accent}>
      <span>{label}</span>
      <strong>{display}</strong>
      <small>{detail || 'Latest successful crawl'}</small>
    </article>
  );
}

function SegmentedControl({ label, options, value, onChange }) {
  return (
    <div className="segmented-group">
      <span>{label}</span>
      <div className="segmented-control">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={option.value === value ? 'active' : ''}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PanelHeader({ title, meta }) {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
      <span>{meta}</span>
    </div>
  );
}

function GrowthTable({ rows, selectedRowid, onSelect }) {
  if (rows.length === 0) {
    return <div className="empty-state">Waiting for the first successful crawl.</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Actor</th>
            <th>NO</th>
            <th>Store</th>
            <th>City</th>
            <th className="num">Public</th>
            <th className="num">VIP</th>
            <th className="num">+Public</th>
            <th className="num">+VIP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.rowid}
              className={row.rowid === selectedRowid ? 'selected' : ''}
              onClick={() => onSelect(row.rowid)}
            >
              <td>
                <div className="actor-cell">
                  <span>{row.name}</span>
                  <small>{row.representativeWork || 'No work'} / {row.representativeRole || 'No role'}</small>
                </div>
              </td>
              <td className="mono">{row.electionId || '-'}</td>
              <td>{row.storeName || '-'}</td>
              <td>{row.city || '-'}</td>
              <td className="num public">{formatNumber(row.publicVotes)}</td>
              <td className="num vip">{formatNumber(row.vipVotes)}</td>
              <td className="num delta">{formatDelta(row.publicDelta)}</td>
              <td className="num delta">{formatDelta(row.vipDelta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActorDetail({ actor }) {
  return (
    <aside className="panel detail-panel">
      <PanelHeader title="Actor Detail" meta={actor ? `NO.${actor.electionId || '-'}` : 'No selection'} />
      {actor ? (
        <div className="detail-content">
          <div className="detail-hero">
            {actor.coverUrl ? <img src={actor.coverUrl} alt="" /> : <div className="cover-placeholder">{actor.name.slice(0, 1)}</div>}
            <div>
              <h3>{actor.name}</h3>
              <p>{actor.storeName || 'Unknown store'}</p>
              <span>{actor.city || 'Unknown city'}</span>
            </div>
          </div>
          <div className="detail-stats">
            <MetricCard label="Current public" value={actor.publicVotes} accent="public" />
            <MetricCard label="Current VIP" value={actor.vipVotes} accent="vip" />
            <MetricCard label="Public delta" value={actor.publicDelta ?? 0} accent="public" prefix="+" />
            <MetricCard label="VIP delta" value={actor.vipDelta ?? 0} accent="vip" prefix="+" />
          </div>
          <div className="detail-copy">
            <label>Representative work</label>
            <p>{actor.representativeWork || '-'} / {actor.representativeRole || '-'}</p>
            <label>Recommendation</label>
            <p>{actor.recommend || 'No recommendation text.'}</p>
            <label>Interval</label>
            <p>{intervalLabel(actor)}</p>
          </div>
        </div>
      ) : (
        <div className="empty-state">Select an actor from the leaderboard.</div>
      )}
    </aside>
  );
}

function LineChart({ trends, metric }) {
  const selectedMetric = metric === 'vip' ? 'vipVotes' : metric === 'public' ? 'publicVotes' : 'both';
  const actor = trends.actors[0];
  const series = trends.series[0]?.points || [];
  const width = 780;
  const height = 260;
  const padding = { left: 46, right: 18, top: 22, bottom: 34 };

  if (!actor || series.length === 0) return <div className="empty-state">Trend appears after the first crawl.</div>;

  const values = selectedMetric === 'both'
    ? series.flatMap((point) => [point.publicVotes, point.vipVotes])
    : series.map((point) => point[selectedMetric]);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);

  const toX = (index) => {
    if (series.length === 1) return padding.left;
    return padding.left + (index / (series.length - 1)) * (width - padding.left - padding.right);
  };
  const toY = (value) => {
    const span = Math.max(max - min, 1);
    return height - padding.bottom - ((value - min) / span) * (height - padding.top - padding.bottom);
  };
  const pathFor = (key) => series.map((point, index) => `${index === 0 ? 'M' : 'L'} ${toX(index)} ${toY(point[key])}`).join(' ');

  return (
    <div className="chart-frame">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Trend chart for ${actor.name}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = padding.top + tick * (height - padding.top - padding.bottom);
          return <line key={tick} x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="grid-line" />;
        })}
        <text x={padding.left} y={height - 10} className="axis-label">{formatShortTime(series[0].capturedAt)}</text>
        <text x={width - padding.right - 72} y={height - 10} className="axis-label">{formatShortTime(series[series.length - 1].capturedAt)}</text>
        <text x={8} y={toY(max) + 4} className="axis-label">{formatNumber(max)}</text>
        <text x={8} y={toY(min) + 4} className="axis-label">{formatNumber(min)}</text>
        {(selectedMetric === 'both' || selectedMetric === 'publicVotes') && <path d={pathFor('publicVotes')} className="line public-line" />}
        {(selectedMetric === 'both' || selectedMetric === 'vipVotes') && <path d={pathFor('vipVotes')} className="line vip-line" />}
        {series.map((point, index) => (
          <g key={`${point.capturedAt}-${index}`}>
            {(selectedMetric === 'both' || selectedMetric === 'publicVotes') && <circle cx={toX(index)} cy={toY(point.publicVotes)} r="3" className="dot public-dot" />}
            {(selectedMetric === 'both' || selectedMetric === 'vipVotes') && <circle cx={toX(index)} cy={toY(point.vipVotes)} r="3" className="dot vip-dot" />}
          </g>
        ))}
      </svg>
      <div className="chart-legend">
        <span><i className="legend-public" /> Public</span>
        <span><i className="legend-vip" /> VIP</span>
      </div>
    </div>
  );
}

function BarChart({ rows, metric }) {
  const metricValue = (row) => {
    if (metric === 'public') return row.publicDelta ?? 0;
    if (metric === 'vip') return row.vipDelta ?? 0;
    return (row.publicDelta ?? 0) + (row.vipDelta ?? 0);
  };
  const max = Math.max(...rows.map(metricValue), 1);

  if (rows.length === 0) return <div className="empty-state">No delta data yet.</div>;

  return (
    <div className="bar-list">
      {rows.map((row) => {
        const value = metricValue(row);
        const width = Math.max(3, (Math.max(value, 0) / max) * 100);
        return (
          <div className="bar-row" key={row.rowid}>
            <div className="bar-label">
              <strong>{row.name}</strong>
              <span>NO.{row.electionId || '-'}</span>
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${width}%` }} />
            </div>
            <span className="bar-value">{formatDelta(value)}</span>
          </div>
        );
      })}
    </div>
  );
}

function formatDateTime(value) {
  if (!value) return 'Waiting';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function formatShortTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function formatCountdown(value, now) {
  if (!value) return 'Scheduling';
  const diff = Math.max(0, new Date(value).getTime() - now);
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

function formatDelta(value) {
  if (value === null || value === undefined) return 'new';
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatNumber(value)}`;
}

function intervalLabel(row) {
  if (!row) return 'Need two snapshots';
  if (!row.previousSnapshotId) return 'First captured snapshot';
  return `${row.minutesSincePrevious || 0} min interval`;
}

createRoot(document.getElementById('root')).render(<App />);

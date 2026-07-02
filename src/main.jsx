import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const METRIC_OPTIONS = [
  { label: '全部', value: 'both' },
  { label: '大众票', value: 'public' },
  { label: 'VIP', value: 'vip' }
];

const RANGE_OPTIONS = [
  { label: '6小时', value: 6 },
  { label: '24小时', value: 24 },
  { label: '7天', value: 168 }
];
const RANKING_OPTIONS = [
  { label: 'VIP票', value: 'vip' },
  { label: '大众票', value: 'public' },
  { label: '最终票数', value: 'final' }
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
  const [rankings, setRankings] = useState({ latestRun: null, sort: 'vip', rows: [] });
  const [trends, setTrends] = useState({ actors: [], series: [] });
  const [metric, setMetric] = useState('both');
  const [rankingSort, setRankingSort] = useState('vip');
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
        const query = new URLSearchParams({ metric, search, rangeHours: String(rangeHours), limit: '100' });
        const rankingQuery = new URLSearchParams({ sort: rankingSort, limit: '50' });
        const [statusRes, summaryRes, deltasRes, rankingsRes] = await Promise.all([
          fetch(apiPath('/api/status'), { signal: controller.signal }),
          fetch(apiPath(`/api/summary?rangeHours=${rangeHours}`), { signal: controller.signal }),
          fetch(apiPath(`/api/deltas?${query}`), { signal: controller.signal }),
          fetch(apiPath(`/api/rankings?${rankingQuery}`), { signal: controller.signal })
        ]);

        if (!statusRes.ok || !summaryRes.ok || !deltasRes.ok || !rankingsRes.ok) throw new Error('看板接口请求失败');

        const [statusData, summaryData, deltasData, rankingsData] = await Promise.all([
          statusRes.json(),
          summaryRes.json(),
          deltasRes.json(),
          rankingsRes.json()
        ]);

        setStatus(statusData);
        setSummary(summaryData);
        setDeltas(deltasData);
        setRankings(rankingsData);
        setError('');

        if (!selectedRowid && deltasData.rows.length > 0) {
          setSelectedRowid(deltasData.rows[0].rowid);
        }
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message || '加载看板数据失败');
      }
    };

    void load();
    const timer = setInterval(load, 30000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [metric, search, rangeHours, rankingSort]);

  useEffect(() => {
    const controller = new AbortController();
    const rowids = selectedRowid || deltas.rows.slice(0, 5).map((row) => row.rowid).join(',');
    if (!rowids) {
      setTrends({ actors: [], series: [] });
      return () => controller.abort();
    }

    fetch(apiPath(`/api/trends?rangeHours=${rangeHours}&rowids=${encodeURIComponent(rowids)}`), { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('趋势接口请求失败');
        return res.json();
      })
      .then(setTrends)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message || '加载趋势数据失败');
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
            <div className="brand-subtitle">票数监控</div>
          </div>
        </div>
        <nav className="nav-list" aria-label="看板分区">
          <span className="nav-item active">总览</span>
          <span className="nav-item">小时增长</span>
          <span className="nav-item">趋势</span>
          <span className="nav-item">演员</span>
        </nav>
        <div className="sidebar-note">
          <span className="status-dot" data-state={status?.isCrawling ? 'busy' : error ? 'error' : 'ok'} />
          <span>{status?.isCrawling ? '正在采集' : error ? '接口异常' : '服务在线'}</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>EGA 票数监控</h1>
            <p>每小时跟踪大众票和 VIP 票增长</p>
          </div>
          <div className="topbar-status">
            <StatusChip label="上次采集" value={formatDateTime(status?.latestRun?.completed_at)} />
            <StatusChip label="下次采集" value={nextRunLabel} />
            <StatusChip label="演员数" value={formatNumber(status?.actorCount || 0)} />
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}
        {status?.latestRun?.status === 'failed' ? (
          <div className="error-banner">上次采集失败：{status.latestRun.error_message}</div>
        ) : null}

        <section className="summary-grid" aria-label="汇总指标">
          <MetricCard label="总演员数" value={summary?.actorCount || 0} accent="neutral" />
          <MetricCard label="大众票增长" value={summary?.rangePublicGrowth || 0} detail={rangeLabel(rangeHours)} accent="public" prefix="+" />
          <MetricCard label="VIP票增长" value={summary?.rangeVipGrowth || 0} detail={rangeLabel(rangeHours)} accent="vip" prefix="+" />
          <MetricCard
            label="增长最高"
            value={summary?.topMover?.name || '等待数据'}
            detail={summary?.topMover ? `总增长 +${summary.topMover.totalDelta}` : '需要至少两次快照'}
            accent="positive"
          />
        </section>

        <section className="controls-row" aria-label="看板筛选">
          <div className="search-box">
            <span>搜索</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="演员、NO、门店、城市"
            />
          </div>
          <SegmentedControl label="指标" options={METRIC_OPTIONS} value={metric} onChange={setMetric} />
          <SegmentedControl label="范围" options={RANGE_OPTIONS} value={rangeHours} onChange={setRangeHours} />
        </section>

        <section className="panel rankings-panel" aria-label="投票数前50排行">
          <div className="ranking-panel-header">
            <div>
              <h2>投票数 Top 50</h2>
              <span>{rankingMeta(rankingSort)}</span>
            </div>
            <InlineSegmentedControl options={RANKING_OPTIONS} value={rankingSort} onChange={setRankingSort} />
          </div>
          <VoteRankingTable rows={rankings.rows} sort={rankingSort} />
        </section>

        <section className="dashboard-grid">
          <div className="panel leaderboard-panel">
            <PanelHeader title="范围增长榜" meta={rangeLabel(rangeHours)} />
            <GrowthTable rows={deltas.rows} selectedRowid={selectedActor?.rowid} onSelect={setSelectedRowid} />
          </div>

          <div className="panel trend-panel">
            <PanelHeader title="票数趋势" meta={rangeLabel(rangeHours)} />
            <LineChart trends={trends} metric={metric} />
          </div>

          <div className="panel bar-panel">
            <PanelHeader title="范围累计增长" meta={rangeLabel(rangeHours)} />
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
      <strong>{value || '等待数据'}</strong>
    </div>
  );
}

function MetricCard({ label, value, detail, accent, prefix = '' }) {
  const numeric = typeof value === 'number';
  const display = numeric ? formatMetricValue(value, prefix) : value;
  return (
    <article className="metric-card" data-accent={accent}>
      <span>{label}</span>
      <strong>{display}</strong>
      <small>{detail || '最近一次成功采集'}</small>
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

function InlineSegmentedControl({ options, value, onChange }) {
  return (
    <div className="inline-segmented" role="group" aria-label="排行排序方式">
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
  );
}

function VoteRankingTable({ rows, sort }) {
  if (rows.length === 0) {
    return <div className="empty-state">等待第一次成功采集。</div>;
  }

  return (
    <div className="ranking-table-wrap">
      <table className="ranking-table">
        <thead>
          <tr>
            <th className="rank-col">排名</th>
            <th>演员</th>
            <th>NO</th>
            <th>门店 / 城市</th>
            <th className="num">VIP票</th>
            <th className="num">大众票</th>
            <th className="num">最终票数</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.rowid}>
              <td className="rank-cell">#{index + 1}</td>
              <td>
                <div className="actor-cell">
                  <span>{row.name}</span>
                  <small>{row.representativeWork || '暂无代表作'} / {row.representativeRole || '暂无角色'}</small>
                </div>
              </td>
              <td className="mono">{row.electionId || '-'}</td>
              <td>{row.storeName || '-'} / {row.city || '-'}</td>
              <td className={`num vip ${sort === 'vip' ? 'sorted-value' : ''}`}>{formatNumber(row.vipVotes)}</td>
              <td className={`num public ${sort === 'public' ? 'sorted-value' : ''}`}>{formatNumber(row.publicVotes)}</td>
              <td className={`num final ${sort === 'final' ? 'sorted-value' : ''}`}>{formatNumber(row.finalVotes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
    return <div className="empty-state">等待第一次成功采集。</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>演员</th>
            <th>NO</th>
            <th>门店</th>
            <th>城市</th>
            <th className="num">大众票</th>
            <th className="num">VIP</th>
            <th className="num">+大众票</th>
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
                  <small>{row.representativeWork || '暂无代表作'} / {row.representativeRole || '暂无角色'}</small>
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
      <PanelHeader title="演员详情" meta={actor ? `NO.${actor.electionId || '-'}` : '未选择'} />
      {actor ? (
        <div className="detail-content">
          <div className="detail-hero">
            {actor.coverUrl ? <img src={actor.coverUrl} alt="" /> : <div className="cover-placeholder">{actor.name.slice(0, 1)}</div>}
            <div>
              <h3>{actor.name}</h3>
              <p>{actor.storeName || '未知门店'}</p>
              <span>{actor.city || '未知城市'}</span>
            </div>
          </div>
          <div className="detail-stats">
            <MetricCard label="当前大众票" value={actor.publicVotes} accent="public" />
            <MetricCard label="当前VIP票" value={actor.vipVotes} accent="vip" />
            <MetricCard label="大众票增量" value={actor.publicDelta ?? 0} accent="public" prefix="+" />
            <MetricCard label="VIP票增量" value={actor.vipDelta ?? 0} accent="vip" prefix="+" />
          </div>
          <div className="detail-copy">
            <label>代表作</label>
            <p>{actor.representativeWork || '-'} / {actor.representativeRole || '-'}</p>
            <label>推荐语</label>
            <p>{actor.recommend || '暂无推荐语。'}</p>
            <label>采集间隔</label>
            <p>{intervalLabel(actor)}</p>
          </div>
        </div>
      ) : (
        <div className="empty-state">从增长榜中选择一位演员。</div>
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

  if (!actor || series.length === 0) return <div className="empty-state">首次采集后会显示趋势。</div>;

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
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${actor.name} 的票数趋势图`}>
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
        <span><i className="legend-public" /> 大众票</span>
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

  if (rows.length === 0) return <div className="empty-state">暂无增量数据。</div>;

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
  if (!value) return '等待数据';
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
  if (!value) return '排程中';
  const diff = Math.max(0, new Date(value).getTime() - now);
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

function formatMetricValue(value, prefix) {
  if (prefix === '+') return `${value > 0 ? '+' : ''}${formatNumber(value)}`;
  return `${prefix}${formatNumber(value)}`;
}

function formatDelta(value) {
  if (value === null || value === undefined) return '首次';
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatNumber(value)}`;
}

function intervalLabel(row) {
  if (!row) return '需要至少两次快照';
  if (!row.previousSnapshotId) return '首次采集快照';
  return `间隔 ${row.minutesSincePrevious || 0} 分钟`;
}

function rankingMeta(sort) {
  if (sort === 'public') return '按大众票排序';
  if (sort === 'final') return '最终票数 = VIP票 × 10 + 大众票';
  return '默认按 VIP 票排序';
}

function rangeLabel(hours) {
  if (hours === 168) return '最近 7 天';
  return `最近 ${hours} 小时`;
}

createRoot(document.getElementById('root')).render(<App />);

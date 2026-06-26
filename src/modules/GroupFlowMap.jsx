import { useMemo, useState } from 'react';
import {
  Network, Calendar, ArrowRight, AlertCircle, Building2, Store, Home,
  RefreshCw, ChevronDown, ChevronRight, Layers,
} from 'lucide-react';

import SectionHeader from '../components/SectionHeader.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import FilterPill from '../components/FilterPill.jsx';
import { supabase } from '../lib/supabase.js';
import { useSupabaseQuery, useEntities } from '../lib/hooks.js';
import { fmtCurrency, cn } from '../lib/utils.js';

// Flow-type display config
const FLOW_TYPES = {
  intercompany_loan: { label: 'Intercompany loans', color: 'var(--ia-orange)',  Icon: ArrowRight },
  rent:              { label: 'Rent',               color: 'var(--ia-warning)', Icon: Home },
  other_expense:     { label: 'Inventory & svcs',   color: 'var(--ia-teal)',    Icon: Store },
};

// Entity role icon
function roleIcon(role) {
  if (role === 'Property') return Home;
  return Store;
}

// SVG geometry constants
const SVG_W = 760;
const SVG_H = 620;
const CENTER_X = SVG_W / 2;
const CENTER_Y = SVG_H / 2 + 10;
const RADIUS = 220;
const NODE_R = 30;

function polarToXY(angle, r) {
  return { x: CENTER_X + r * Math.cos(angle), y: CENTER_Y + r * Math.sin(angle) };
}

// Position nodes around a circle. Order: properties (top arc), then SI parent + SI-IL,
// then retail operating entities along the bottom arc.
function computeNodePositions(entities) {
  // Group entities by role
  const properties = entities.filter((e) => e.entity_role === 'Property');
  const operating  = entities.filter((e) => e.entity_role !== 'Property');
  // Order operating: SI parent (id 4) first, SI-IL (id 3) second, then the rest by short name
  operating.sort((a, b) => {
    if (a.id === 4) return -1;
    if (b.id === 4) return 1;
    if (a.id === 3) return -1;
    if (b.id === 3) return 1;
    return a.entity_short_name.localeCompare(b.entity_short_name);
  });
  // Properties along top arc (from -150 to -30 degrees in math convention, ie top)
  // Operating along bottom arc (from 30 to 330)
  const ordered = [...properties, ...operating];
  const N = ordered.length;
  // Distribute around full circle starting at top
  const positions = {};
  ordered.forEach((e, i) => {
    // Start at top (-pi/2) and go clockwise
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / N;
    const { x, y } = polarToXY(angle, RADIUS);
    positions[e.id] = { x, y, angle, entity: e };
  });
  return positions;
}

// Quadratic Bezier path between two points, control pulled toward chart center.
function bezierPath(x1, y1, x2, y2) {
  // Control point: 35% from midpoint toward center
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const cx = mx + (CENTER_X - mx) * 0.7;
  const cy = my + (CENTER_Y - my) * 0.7;
  return `M ${x1},${y1} Q ${cx},${cy} ${x2},${y2}`;
}

export default function GroupFlowMap() {
  const entitiesQ = useEntities();
  const entities = (entitiesQ.data ?? []).filter((e) => e.is_active);

  // Year filter — default to most recent full year (2025)
  const [yearFilter, setYearFilter] = useState('2025');
  const [activeTypes, setActiveTypes] = useState({
    intercompany_loan: true,
    rent: true,
    other_expense: true,
  });
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState(null);
  const [hoveredEntityId, setHoveredEntityId] = useState(null);
  const [pinnedEntityId, setPinnedEntityId] = useState(null);

  // Fetch all flows once; filter in-memory
  const flowsQ = useSupabaseQuery(
    () => supabase
      .from('intercompany_flow_summary_view')
      .select('*')
      .order('period', { ascending: false }),
    [],
  );
  const allFlows = flowsQ.data ?? [];

  // Available years from data
  const availableYears = useMemo(() => {
    const ys = new Set(allFlows.map((f) => new Date(f.period).getUTCFullYear()));
    return Array.from(ys).sort((a, b) => b - a);
  }, [allFlows]);

  // Apply filters
  const filteredFlows = useMemo(() => {
    return allFlows.filter((f) => {
      const fy = String(new Date(f.period).getUTCFullYear());
      if (yearFilter !== 'all' && fy !== yearFilter) return false;
      if (!activeTypes[f.flow_type]) return false;
      return true;
    });
  }, [allFlows, yearFilter, activeTypes]);

  // Aggregate edges: one row per (from, to, type)
  const edges = useMemo(() => {
    const m = new Map();
    for (const f of filteredFlows) {
      const k = `${f.from_entity}->${f.to_entity}|${f.flow_type}`;
      const prev = m.get(k) ?? { from: f.from_entity, to: f.to_entity, type: f.flow_type, amount: 0 };
      prev.amount += Number(f.amount);
      m.set(k, prev);
    }
    return Array.from(m.values()).sort((a, b) => b.amount - a.amount);
  }, [filteredFlows]);

  // Per-entity totals (in + out)
  const entityTotals = useMemo(() => {
    const m = new Map();
    for (const e of edges) {
      const fromRow = m.get(e.from) ?? { out: 0, in: 0 };
      fromRow.out += e.amount;
      m.set(e.from, fromRow);
      const toRow = m.get(e.to) ?? { out: 0, in: 0 };
      toRow.in += e.amount;
      m.set(e.to, toRow);
    }
    return m;
  }, [edges]);

  // Edge thickness scale (log-based, capped 1.5 to 14 px)
  const { thicknessFor } = useMemo(() => {
    if (edges.length === 0) return { thicknessFor: () => 1.5 };
    const max = Math.max(...edges.map((e) => e.amount));
    const min = Math.min(...edges.map((e) => e.amount));
    return {
      thicknessFor: (amt) => {
        if (max === min) return 4;
        const t = Math.log10(amt + 1) / Math.log10(max + 1);
        return 1.5 + t * 12.5;
      },
    };
  }, [edges]);

  const positions = useMemo(() => computeNodePositions(entities), [entities]);

  // Active entity for highlighting (pinned takes priority over hover)
  const focusEntityId = pinnedEntityId ?? hoveredEntityId;
  const focusedEdges = useMemo(() => {
    if (focusEntityId == null) return null;
    return new Set(
      edges
        .filter((e) => e.from === focusEntityId || e.to === focusEntityId)
        .map((e) => `${e.from}->${e.to}|${e.type}`)
    );
  }, [edges, focusEntityId]);

  const loading = entitiesQ.loading || flowsQ.loading;

  // Aggregate metrics for the header strip
  const totals = useMemo(() => {
    const t = { rent: 0, intercompany_loan: 0, other_expense: 0, all: 0 };
    for (const e of edges) {
      t[e.type] += e.amount;
      t.all += e.amount;
    }
    return t;
  }, [edges]);

  return (
    <section className="space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="inline-flex items-center gap-2">
            <Network size={22} /> Group Flow Map
          </h1>
          <p className="text-sm text-ia-muted mt-1 max-w-3xl">
            Where value moves between your 11 entities. Rent paid to property entities, inventory bought from
            the Sunshine Imports parent, intercompany advances. Big anomalies show up here as outsized arcs —
            no hunting through line items required.
          </p>
        </div>
        <button
          className="ia-button-ghost"
          onClick={() => { flowsQ.refetch(); entitiesQ.refetch(); }}
          aria-label="Refresh flow data"
        >
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
      </header>

      {/* Header strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="ia-card">
          <div className="text-[10px] uppercase font-medium text-ia-muted">Total flow (filtered)</div>
          <div className="ia-currency-hero text-2xl mt-1">{fmtCurrency(totals.all)}</div>
          <div className="text-xs text-ia-muted mt-1">{edges.length} edges · {yearFilter === 'all' ? 'all time' : yearFilter}</div>
        </div>
        {Object.entries(FLOW_TYPES).map(([key, cfg]) => {
          const Icon = cfg.Icon;
          return (
            <div key={key} className="ia-card">
              <div className="text-[10px] uppercase font-medium text-ia-muted inline-flex items-center gap-1">
                <Icon size={11} style={{ color: cfg.color }} /> {cfg.label}
              </div>
              <div className="text-2xl font-semibold mt-1" style={{ color: cfg.color }}>
                {fmtCurrency(totals[key] ?? 0)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-ia-muted uppercase mr-1 inline-flex items-center gap-1">
          <Calendar size={12} /> Year
        </span>
        <FilterPill label="All time" active={yearFilter === 'all'} onClick={() => setYearFilter('all')} />
        {availableYears.map((y) => (
          <FilterPill key={y} label={String(y)} active={yearFilter === String(y)} onClick={() => setYearFilter(String(y))} />
        ))}
        <span className="text-xs text-ia-muted ml-3 mr-1 inline-flex items-center gap-1">
          <Layers size={12} /> Show
        </span>
        {Object.entries(FLOW_TYPES).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setActiveTypes((s) => ({ ...s, [key]: !s[key] }))}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors',
              activeTypes[key]
                ? 'border-ia-border bg-ia-card-hover text-ia-navy'
                : 'border-ia-border bg-ia-card text-ia-muted opacity-60 hover:opacity-100'
            )}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.color }} />
            {cfg.label}
          </button>
        ))}
      </div>

      {/* The diagram */}
      <div className="ia-card overflow-hidden">
        {loading ? <LoadingState /> : edges.length === 0 ? (
          <EmptyState
            icon={Network}
            title="No flows in this slice"
            description="Try expanding the year filter or toggling flow types back on."
          />
        ) : (
          <div className="flex flex-col items-center">
            <svg
              viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              className="w-full max-w-3xl"
              style={{ background: 'transparent' }}
              role="img"
              aria-label="Cross-entity flow diagram"
            >
              {/* Arrow marker defs, one per flow type */}
              <defs>
                {Object.entries(FLOW_TYPES).map(([key, cfg]) => (
                  <marker
                    key={key}
                    id={`arrow-${key}`}
                    viewBox="0 0 10 10"
                    refX="8" refY="5"
                    markerWidth="7" markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill={cfg.color} />
                  </marker>
                ))}
              </defs>

              {/* Edges (drawn first so nodes sit on top) */}
              {edges.map((e) => {
                const from = positions[e.from];
                const to = positions[e.to];
                if (!from || !to) return null;
                const k = `${e.from}->${e.to}|${e.type}`;
                const cfg = FLOW_TYPES[e.type];
                const isFocused = focusedEdges?.has(k);
                const isHovered = hoveredEdgeKey === k;
                const dimmed = (focusedEdges && !isFocused) || (hoveredEdgeKey && !isHovered);
                const thickness = thicknessFor(e.amount);
                return (
                  <g
                    key={k}
                    onMouseEnter={() => setHoveredEdgeKey(k)}
                    onMouseLeave={() => setHoveredEdgeKey(null)}
                    style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                    opacity={dimmed ? 0.15 : (isFocused || isHovered) ? 1 : 0.75}
                  >
                    <path
                      d={bezierPath(from.x, from.y, to.x, to.y)}
                      fill="none"
                      stroke={cfg.color}
                      strokeWidth={isHovered ? thickness + 2 : thickness}
                      strokeLinecap="round"
                      markerEnd={`url(#arrow-${e.type})`}
                    />
                  </g>
                );
              })}

              {/* Nodes */}
              {entities.map((e) => {
                const pos = positions[e.id];
                if (!pos) return null;
                const total = entityTotals.get(e.id) ?? { in: 0, out: 0 };
                const RoleIcon = roleIcon(e.entity_role);
                const isFocused = focusEntityId === e.id;
                const isDimmed = focusEntityId != null && !isFocused &&
                  ![...(focusedEdges ?? [])].some((k) => k.includes(`${e.id}->`) || k.includes(`->${e.id}|`));
                const ringColor = e.entity_role === 'Property' ? 'var(--ia-warning)' : 'var(--ia-teal)';
                const labelOffsetY = pos.y < CENTER_Y - 50 ? -NODE_R - 14 : pos.y > CENTER_Y + 50 ? NODE_R + 18 : 0;
                const labelOffsetX = pos.x < CENTER_X - 50 ? -NODE_R - 6 : pos.x > CENTER_X + 50 ? NODE_R + 6 : 0;
                const labelAnchor = labelOffsetX < 0 ? 'end' : labelOffsetX > 0 ? 'start' : 'middle';
                return (
                  <g
                    key={e.id}
                    onMouseEnter={() => setHoveredEntityId(e.id)}
                    onMouseLeave={() => setHoveredEntityId(null)}
                    onClick={() => setPinnedEntityId(pinnedEntityId === e.id ? null : e.id)}
                    style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                    opacity={isDimmed ? 0.3 : 1}
                  >
                    <circle
                      cx={pos.x} cy={pos.y} r={NODE_R}
                      fill="var(--ia-card)"
                      stroke={ringColor}
                      strokeWidth={isFocused ? 3.5 : 2}
                    />
                    <text
                      x={pos.x} y={pos.y - 2}
                      textAnchor="middle"
                      fontSize="10"
                      fontWeight="600"
                      fill="var(--ia-navy)"
                      style={{ pointerEvents: 'none' }}
                    >
                      {e.entity_short_name.replace('sunshine-', 'S-').replace('-properties', '').replace('-general-store', '').slice(0, 10)}
                    </text>
                    <text
                      x={pos.x} y={pos.y + 10}
                      textAnchor="middle"
                      fontSize="8"
                      fill="var(--ia-muted)"
                      style={{ pointerEvents: 'none' }}
                    >
                      {e.entity_role}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Hint */}
            <div className="text-[11px] text-ia-muted mt-2">
              Hover an arc for details · Click an entity to pin its connections{pinnedEntityId != null && ' · '}
              {pinnedEntityId != null && (
                <button onClick={() => setPinnedEntityId(null)} className="text-ia-teal hover:underline">
                  clear pin
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Hover/pin detail panel */}
      {(hoveredEdgeKey || focusEntityId) && (
        <DetailPanel
          edges={edges}
          entities={entities}
          hoveredEdgeKey={hoveredEdgeKey}
          focusEntityId={focusEntityId}
          allFlows={filteredFlows}
        />
      )}

      {/* Full table view */}
      <FlowsTable edges={edges} entities={entities} />
    </section>
  );
}

// ===========================================================================
// Detail panel — shows when an arc is hovered or an entity is focused
// ===========================================================================
function DetailPanel({ edges, entities, hoveredEdgeKey, focusEntityId, allFlows }) {
  const eById = useMemo(() => Object.fromEntries(entities.map((e) => [e.id, e])), [entities]);

  if (hoveredEdgeKey) {
    const edge = edges.find((e) => `${e.from}->${e.to}|${e.type}` === hoveredEdgeKey);
    if (!edge) return null;
    const cfg = FLOW_TYPES[edge.type];
    const componentRows = allFlows
      .filter((f) => f.from_entity === edge.from && f.to_entity === edge.to && f.flow_type === edge.type)
      .sort((a, b) => new Date(b.period) - new Date(a.period));
    return (
      <div className="ia-card">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.color }} />
          <span className="font-medium text-ia-navy">
            {eById[edge.from]?.entity_short_name} <ArrowRight size={12} className="inline" /> {eById[edge.to]?.entity_short_name}
          </span>
          <span className="text-xs text-ia-muted">· {cfg.label}</span>
          <span className="ia-currency-hero ml-auto">{fmtCurrency(edge.amount)}</span>
        </div>
        <div className="text-[11px] text-ia-muted mb-2">{componentRows.length} months</div>
        <div className="text-xs text-ia-ink space-y-0.5 max-h-40 overflow-auto">
          {componentRows.map((r, i) => (
            <div key={i} className="flex justify-between border-b border-ia-border/40 py-0.5">
              <span>{new Date(r.period).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}</span>
              <span className="text-ia-navy">{fmtCurrency(r.amount)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (focusEntityId != null) {
    const ent = eById[focusEntityId];
    const inEdges = edges.filter((e) => e.to === focusEntityId);
    const outEdges = edges.filter((e) => e.from === focusEntityId);
    const inTotal = inEdges.reduce((a, e) => a + e.amount, 0);
    const outTotal = outEdges.reduce((a, e) => a + e.amount, 0);
    return (
      <div className="ia-card">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="font-medium text-ia-navy">{ent?.legal_name}</div>
            <div className="text-xs text-ia-muted">{ent?.entity_short_name} · {ent?.entity_role}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase text-ia-muted">Net flow</div>
            <div className="ia-currency-hero text-lg">{fmtCurrency(inTotal - outTotal)}</div>
            <div className="text-[10px] text-ia-muted">in {fmtCurrency(inTotal)} · out {fmtCurrency(outTotal)}</div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] uppercase font-medium text-ia-muted mb-1">Inflows (paid to this entity)</div>
            {inEdges.length === 0 ? <div className="text-xs text-ia-muted italic">None</div> :
              inEdges.map((e) => (
                <div key={`in-${e.from}-${e.type}`} className="flex items-center justify-between border-b border-ia-border/40 py-1 text-xs">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: FLOW_TYPES[e.type].color }} />
                    {eById[e.from]?.entity_short_name}
                  </span>
                  <span className="text-ia-navy">{fmtCurrency(e.amount)}</span>
                </div>
              ))}
          </div>
          <div>
            <div className="text-[10px] uppercase font-medium text-ia-muted mb-1">Outflows (paid by this entity)</div>
            {outEdges.length === 0 ? <div className="text-xs text-ia-muted italic">None</div> :
              outEdges.map((e) => (
                <div key={`out-${e.to}-${e.type}`} className="flex items-center justify-between border-b border-ia-border/40 py-1 text-xs">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: FLOW_TYPES[e.type].color }} />
                    {eById[e.to]?.entity_short_name}
                  </span>
                  <span className="text-ia-navy">{fmtCurrency(e.amount)}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ===========================================================================
// Full table view — sortable list of all edges
// ===========================================================================
function FlowsTable({ edges, entities }) {
  const eById = useMemo(() => Object.fromEntries(entities.map((e) => [e.id, e])), [entities]);
  const [expanded, setExpanded] = useState(false);

  if (edges.length === 0) return null;

  const sorted = [...edges].sort((a, b) => b.amount - a.amount);
  const visible = expanded ? sorted : sorted.slice(0, 12);

  return (
    <div className="ia-card">
      <SectionHeader title="All flows (filtered)" subtitle={`${edges.length} edges · sorted by magnitude`} />
      <table className="ia-table mt-2">
        <thead>
          <tr>
            <th>From</th>
            <th></th>
            <th>To</th>
            <th>Type</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((e) => {
            const cfg = FLOW_TYPES[e.type];
            return (
              <tr key={`${e.from}-${e.to}-${e.type}`}>
                <td className="text-sm">{eById[e.from]?.entity_short_name ?? `#${e.from}`}</td>
                <td><ArrowRight size={12} className="text-ia-muted" /></td>
                <td className="text-sm">{eById[e.to]?.entity_short_name ?? `#${e.to}`}</td>
                <td>
                  <span className="inline-flex items-center gap-1 text-xs">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.color }} />
                    {cfg.label}
                  </span>
                </td>
                <td className="text-right font-medium" style={{ color: cfg.color }}>{fmtCurrency(e.amount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {edges.length > 12 && (
        <button
          className="text-xs text-ia-teal hover:underline mt-2 inline-flex items-center gap-1"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          {expanded ? 'Collapse' : `Show all ${edges.length}`}
        </button>
      )}
    </div>
  );
}

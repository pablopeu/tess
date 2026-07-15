import {
  type Vec2, type EdgeDef, type FundamentalRegion,
  sub, add, dot, distToSegment, lerp,
} from './types';

// ─── Segment data ────────────────────────────────────────────────

/**
 * Un punto de segmento sobre un edge.
 * - `t`: parámetro [0,1] a lo largo del edge (desde start hacia end).
 * - `offset`: desplazamiento desde la línea del edge (permite deformar).
 */
export interface SegmentPoint {
  t: number;
  offset: Vec2;
}

export interface EdgeWithSegments extends EdgeDef {
  segments: SegmentPoint[];
}

function segPos(verts: Vec2[], e: EdgeWithSegments, seg: SegmentPoint): Vec2 {
  const start = verts[e.start];
  const end = verts[e.end];
  return add(lerp(start, end, seg.t), seg.offset);
}

// ─── Construcción inicial p1 ─────────────────────────────────────

export function buildInitialP1Region(pts: Vec2[]): FundamentalRegion | null {
  const n = pts.length;
  if (n === 3) {
    const D = { x: pts[0].x + pts[2].x - pts[1].x, y: pts[0].y + pts[2].y - pts[1].y };
    return buildP1FromVerts([pts[0], pts[1], pts[2], D], true);
  }
  if (n === 4) {
    return buildP1FromVerts([...pts], false);
  }
  return null;
}

function buildP1FromVerts(verts: Vec2[], isTriangle: boolean): FundamentalRegion {
  const u = sub(verts[1], verts[0]);
  const v = sub(verts[3], verts[0]);
  const edges: EdgeWithSegments[] = [
    { id: 'e0', start: 0, end: 1, pairId: 'e2', segments: [] },
    { id: 'e1', start: 1, end: 2, pairId: 'e3', segments: [] },
    { id: 'e2', start: 2, end: 3, pairId: 'e0', segments: [] },
    { id: 'e3', start: 3, end: 0, pairId: 'e1', segments: [] },
  ];
  return { vertices: verts, edges, u, v, isTriangle };
}

// ─── Encontrar borde más cercano ─────────────────────────────────

export interface EdgeHit {
  edgeIdx: number;
  t: number;
  dist: number;
}

export function findNearestEdge(region: FundamentalRegion, pos: Vec2, threshold = 30): EdgeHit | null {
  const edges = region.edges as EdgeWithSegments[];
  const verts = region.vertices;
  let best: EdgeHit | null = null;

  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei];
    const pts = getEdgeWorldPoints(verts, e);
    for (let si = 0; si < pts.length - 1; si++) {
      const a = pts[si];
      const b = pts[si + 1];
      const d = distToSegment(pos, a, b);
      if (d < threshold && (!best || d < best.dist)) {
        const ab = sub(b, a);
        const abLen2 = dot(ab, ab);
        let t = 0;
        if (abLen2 > 0) {
          t = dot(sub(pos, a), ab) / abLen2;
          t = Math.max(0, Math.min(1, t));
        }
        const segCount = pts.length - 1;
        const globalT = (si + t) / segCount;
        best = { edgeIdx: ei, t: Math.max(0.1, Math.min(0.9, globalT)), dist: d };
      }
    }
  }
  return best;
}

/** Puntos del edge en coordenadas del mundo (start → segments → end). */
function getEdgeWorldPoints(verts: Vec2[], e: EdgeWithSegments): Vec2[] {
  const pts: Vec2[] = [verts[e.start]];
  for (const seg of e.segments) pts.push(segPos(verts, e, seg));
  pts.push(verts[e.end]);
  return pts;
}

// ─── Subdividir borde ───────────────────────────────────────────

export function subdivideEdge(region: FundamentalRegion, edgeIdx: number, t: number): void {
  const edges = region.edges as EdgeWithSegments[];
  const e = edges[edgeIdx];

  e.segments.push({ t, offset: { x: 0, y: 0 } });
  e.segments.sort((a, b) => a.t - b.t);

  // Paired edge is traversed in opposite direction, so use 1-t
  const pairEdge = edges.find(ed => ed.id === e.pairId)!;
  const pairT = 1 - t;
  pairEdge.segments.push({ t: pairT, offset: { x: 0, y: 0 } });
  pairEdge.segments.sort((a, b) => a.t - b.t);
}

// ─── Obtener polígono cerrado ───────────────────────────────────

export function getPolygonPoints(region: FundamentalRegion): Vec2[] {
  const edges = region.edges as EdgeWithSegments[];
  const verts = region.vertices;
  const pts: Vec2[] = [];
  for (const e of edges) {
    pts.push(verts[e.start]);
    for (const seg of e.segments) pts.push(segPos(verts, e, seg));
  }
  return pts;
}

// ─── Mutación de vértices ────────────────────────────────────────

export function moveVertex(region: FundamentalRegion, idx: number, delta: Vec2): void {
  if (idx < 0 || idx > 3) return;
  const opp = [2, 3, 0, 1][idx];
  region.vertices[idx] = { x: region.vertices[idx].x + delta.x, y: region.vertices[idx].y + delta.y };
  region.vertices[opp] = { x: region.vertices[opp].x - delta.x, y: region.vertices[opp].y - delta.y };
  region.u = sub(region.vertices[1], region.vertices[0]);
  region.v = sub(region.vertices[3], region.vertices[0]);
}

// ─── Mover segmento ─────────────────────────────────────────────

/**
 * Mueve un punto de segmento por índice en el array de polygon points.
 * pidx > 3 indica que es un punto de segmento.
 */
export function moveSegmentPoint(region: FundamentalRegion, pidx: number, delta: Vec2): void {
  const edges = region.edges as EdgeWithSegments[];
  let runningIdx = 1; // e0.start is at 0, we skip it
  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei];
    const numSegs = e.segments.length;
    if (pidx < runningIdx + numSegs) {
      const segIdx = pidx - runningIdx;
      const seg = e.segments[segIdx];
      seg.offset = { x: seg.offset.x + delta.x, y: seg.offset.y + delta.y };
      // Sync with paired edge: the segments are sorted in opposite order
      // because paired edge uses 1-t, so segIdx ↔ (numSegs - 1 - segIdx)
      const pairEdge = edges.find(ed => ed.id === e.pairId)!;
      const pairSegIdx = pairEdge.segments.length - 1 - segIdx;
      if (pairSegIdx >= 0 && pairSegIdx < pairEdge.segments.length) {
        const pairSeg = pairEdge.segments[pairSegIdx];
        pairSeg.offset = { x: pairSeg.offset.x + delta.x, y: pairSeg.offset.y + delta.y };
      }
      return;
    }
    runningIdx += 1 + numSegs;
  }
}

export function countSegments(region: FundamentalRegion): number {
  const edges = region.edges as EdgeWithSegments[];
  return edges.reduce((sum, e) => sum + e.segments.length, 0);
}

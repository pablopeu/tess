import {
  type Vec2, type FundamentalRegion,
  add, vec2, curveToPath,
} from './types';

// ─── Generación del plano teselado ─────────────────────────────────

export interface TiledEdge {
  pathD: string;
  /** Índice del edge en la región fundamental (0-3). */
  sourceEdgeIdx: number;
  /** Celda (col, row) donde aparece. */
  cellCol: number;
  cellRow: number;
}

export interface TiledVertex {
  pos: Vec2;
  /** Índice del vértice en la región fundamental (0-3). */
  sourceVertexIdx: number;
  /** Celda donde aparece. */
  cellCol: number;
  cellRow: number;
}

export interface TiledControlPoint {
  pos: Vec2;
  sourceEdgeIdx: number;
  cellCol: number;
  cellRow: number;
}

export interface TilingData {
  edges: TiledEdge[];
  vertices: TiledVertex[];
  controlPoints: TiledControlPoint[];
}

/**
 * Genera una teselación N×N a partir de la región fundamental
 * aplicando el grupo p1 (traslaciones puras).
 *
 * El resultado NO son copias: cada borde visible es la misma
 * curva fuente evaluada en una traslación diferente del grupo.
 */
export function generateP1Tiling(
  region: FundamentalRegion,
  cols: number,
  rows: number,
): TilingData {
  const edges: TiledEdge[] = [];
  const vertices: TiledVertex[] = [];
  const controlPoints: TiledControlPoint[] = [];

  const startCol = -Math.floor(cols / 2);
  const endCol = startCol + cols;
  const startRow = -Math.floor(rows / 2);
  const endRow = startRow + rows;

  for (let row = startRow; row < endRow; row++) {
    for (let col = startCol; col < endCol; col++) {
      const offset = vec2(col * region.u.x + row * region.v.x, col * region.u.y + row * region.v.y);

      for (let ei = 0; ei < region.edges.length; ei++) {
        const edge = region.edges[ei];
        const start = add(region.vertices[edge.start], offset);
        const end = add(region.vertices[edge.end], offset);
        const pathD = curveToPath(edge.curve, start, end);

        edges.push({
          pathD,
          sourceEdgeIdx: ei,
          cellCol: col,
          cellRow: row,
        });
      }

      // Vértices
      for (let vi = 0; vi < region.vertices.length; vi++) {
        vertices.push({
          pos: add(region.vertices[vi], offset),
          sourceVertexIdx: vi,
          cellCol: col,
          cellRow: row,
        });
      }

      // Puntos de control
      for (let ei = 0; ei < region.edges.length; ei++) {
        const edge = region.edges[ei];
        if (edge.curve.type === 'quadratic' && edge.curve.ctrl.length > 0) {
          const start = add(region.vertices[edge.start], offset);
          const cp = add(start, edge.curve.ctrl[0]);
          controlPoints.push({
            pos: cp,
            sourceEdgeIdx: ei,
            cellCol: col,
            cellRow: row,
          });
        }
      }
    }
  }

  return { edges, vertices, controlPoints };
}

// ─── Hit testing ───────────────────────────────────────────────────

export interface HitResult {
  kind: 'vertex' | 'control' | 'edge';
  sourceVertexIdx?: number;
  sourceEdgeIdx?: number;
  pos: Vec2;
  cellCol: number;
  cellRow: number;
}

const HIT_RADIUS = 12;

/**
 * Dada una posición en coordenadas del viewport, determina
 * si el usuario hizo clic en un vértice, punto de control, o borde.
 * Encuentra la celda VISUAL más cercana, no la fundamental.
 */
export function hitTest(tiling: TilingData, point: Vec2): HitResult | null {
  // 1) Probar vértices (prioridad más alta)
  let best: HitResult | null = null;
  let bestDist = HIT_RADIUS;

  for (const v of tiling.vertices) {
    const d = dist(point, v.pos);
    if (d < bestDist) {
      bestDist = d;
      best = {
        kind: 'vertex',
        sourceVertexIdx: v.sourceVertexIdx,
        pos: v.pos,
        cellCol: v.cellCol,
        cellRow: v.cellRow,
      };
    }
  }

  // 2) Probar puntos de control
  for (const cp of tiling.controlPoints) {
    const d = dist(point, cp.pos);
    if (d < bestDist) {
      bestDist = d;
      best = {
        kind: 'control',
        sourceEdgeIdx: cp.sourceEdgeIdx,
        pos: cp.pos,
        cellCol: cp.cellCol,
        cellRow: cp.cellRow,
      };
    }
  }

  // 3) Probar bordes (distancia al segmento/curva)
  // Por ahora solo implementamos distancia a segmentos rectos
  if (!best) {
    for (const e of tiling.edges) {
      // Tomamos el primer y segundo punto del path
      const d = distToPathD(e.pathD, point);
      if (d < bestDist) {
        bestDist = d;
        best = {
          kind: 'edge',
          sourceEdgeIdx: e.sourceEdgeIdx,
          pos: point,
          cellCol: e.cellCol,
          cellRow: e.cellRow,
        };
      }
    }
  }

  return best;
}

// ─── Utilidades geométricas ────────────────────────────────────────

function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Distancia aproximada de un punto a un SVG path (solo M/L/Q).
 * Para la primera versión parseamos el pathD y testeamos
 * contra el segmento o curva.
 */
function distToPathD(pathD: string, point: Vec2): number {
  const parts = pathD.split(' ');
  if (parts.length < 4) return Infinity;

  const sx = parseFloat(parts[1]);
  const sy = parseFloat(parts[2]);
  const cmd = parts[3];

  if (cmd === 'L') {
    const ex = parseFloat(parts[4]);
    const ey = parseFloat(parts[5]);
    return distToSegment(point, { x: sx, y: sy }, { x: ex, y: ey });
  }

  if (cmd === 'Q') {
    const cpx = parseFloat(parts[4]);
    const cpy = parseFloat(parts[5]);
    const ex = parseFloat(parts[6]);
    const ey = parseFloat(parts[7]);
    return distToQuadratic(point, { x: sx, y: sy }, { x: cpx, y: cpy }, { x: ex, y: ey });
  }

  return Infinity;
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return dist(p, a);

  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));

  const projx = a.x + t * abx;
  const projy = a.y + t * aby;
  return dist(p, { x: projx, y: projy });
}

/** Distancia aproximada a una cuadrática (muestreo). */
function distToQuadratic(p: Vec2, s: Vec2, cp: Vec2, e: Vec2): number {
  let minD = Infinity;
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const s1 = 1 - t;
    const qx = s1 * s1 * s.x + 2 * s1 * t * cp.x + t * t * e.x;
    const qy = s1 * s1 * s.y + 2 * s1 * t * cp.y + t * t * e.y;
    const d = dist(p, { x: qx, y: qy });
    if (d < minD) minD = d;
  }
  return minD;
}

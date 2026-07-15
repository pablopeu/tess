import {
  type Vec2, type EdgeId, type EdgeDef, type Transform,
  type FundamentalRegion,
  vec2, add, sub, curveLine,
} from './types';

// ─── Fábrica: modo Rectangular (p1) ───────────────────────────────

const EDGE_TOP    = 'top' as EdgeId;
const EDGE_RIGHT  = 'right' as EdgeId;
const EDGE_BOTTOM = 'bottom' as EdgeId;
const EDGE_LEFT   = 'left' as EdgeId;

interface RectOpts {
  cx?: number;
  cy?: number;
  width?: number;
  height?: number;
}

export function createRectangularRegion(opts: RectOpts = {}): FundamentalRegion {
  const w = opts.width ?? 400;
  const h = opts.height ?? 300;
  const cx = opts.cx ?? 0;
  const cy = opts.cy ?? 0;

  const halfW = w / 2;
  const halfH = h / 2;

  // Vértices centrados en (cx, cy)
  const v0 = vec2(cx - halfW, cy - halfH); // top-left
  const v1 = vec2(cx + halfW, cy - halfH); // top-right
  const v2 = vec2(cx + halfW, cy + halfH); // bottom-right
  const v3 = vec2(cx - halfW, cy + halfH); // bottom-left

  const u = vec2(w, 0);   // traslación horizontal
  const v = vec2(0, h);   // traslación vertical

  // Emparejamientos:
  //   top  ↔ bottom :  translate(0, h)
  //   left ↔ right  :  translate(w, 0)
  const edges: EdgeDef[] = [
    edgeDef(EDGE_TOP,    0, 1, EDGE_BOTTOM, { dx: 0, dy: h }),
    edgeDef(EDGE_RIGHT,  1, 2, EDGE_LEFT,   { dx: -w, dy: 0 }),
    edgeDef(EDGE_BOTTOM, 2, 3, EDGE_TOP,    { dx: 0, dy: -h }),
    edgeDef(EDGE_LEFT,   3, 0, EDGE_RIGHT,  { dx: w, dy: 0 }),
  ];

  return { vertices: [v0, v1, v2, v3], edges, u, v };
}

function edgeDef(
  id: EdgeId, s: number, e: number,
  pairId: EdgeId, pairXform: Transform,
): EdgeDef {
  return { id, start: s, end: e, curve: curveLine(), pairId, pairTransform: pairXform };
}

// ─── Consultas ─────────────────────────────────────────────────────

export function edgeEndpoints(reg: FundamentalRegion, idx: number): [Vec2, Vec2] {
  const edge = reg.edges[idx];
  return [reg.vertices[edge.start], reg.vertices[edge.end]];
}

export function edgePairIdx(reg: FundamentalRegion, idx: number): number {
  const pairId = reg.edges[idx].pairId;
  return reg.edges.findIndex(e => e.id === pairId);
}

// ─── Mutaciones guiadas ────────────────────────────────────────────

/**
 * Mueve un vértice de la región fundamental (por índice).
 * En modo p1 rectangular, el vértice opuesto se mueve en espejo
 * para mantener la estructura de paralelogramo.
 */
export function moveVertex(reg: FundamentalRegion, idx: number, delta: Vec2): void {
  // Mapa de oposiciones: 0↔2, 1↔3
  const opposite = [2, 3, 0, 1];
  const oppIdx = opposite[idx];

  // Mover el vértice
  reg.vertices[idx] = add(reg.vertices[idx], delta);
  // Mover el opuesto en espejo
  reg.vertices[oppIdx] = sub(reg.vertices[oppIdx], delta);

  // Recalcular u y v desde los vértices
  reg.u = sub(reg.vertices[1], reg.vertices[0]);
  reg.v = sub(reg.vertices[3], reg.vertices[0]);
}

/**
 * Convierte un borde recto en una curva cuadrática con un punto
 * de control en la posición dada (coordenadas absolutas del viewport,
 * que convertimos a relativas al start del edge).
 */
export function bendEdge(reg: FundamentalRegion, edgeIdx: number, absCp: Vec2): void {
  const edge = reg.edges[edgeIdx];
  const start = reg.vertices[edge.start];
  const relCp = sub(absCp, start);
  edge.curve = { type: 'quadratic', ctrl: [relCp] };

  // Sincronizar el borde emparejado
  syncPairedEdge(reg, edgeIdx);
}

/**
 * Mueve el punto de control de un borde curvo.
 */
export function moveControlPoint(reg: FundamentalRegion, edgeIdx: number, absCp: Vec2): void {
  const edge = reg.edges[edgeIdx];
  if (edge.curve.type !== 'quadratic') return;

  const start = reg.vertices[edge.start];
  edge.curve = {
    type: 'quadratic',
    ctrl: [sub(absCp, start)],
  };

  syncPairedEdge(reg, edgeIdx);
}

// ─── Sincronización de emparejamientos ────────────────────────────

/**
 * Copia la curva de `edgeIdx` a su borde emparejado,
 * aplicando la transformación inversa para mantener la consistencia
 * bajo el grupo.
 */
function syncPairedEdge(reg: FundamentalRegion, edgeIdx: number): void {
  const edge = reg.edges[edgeIdx];
  const pairIdx = reg.edges.findIndex(e => e.id === edge.pairId);
  if (pairIdx === -1 || pairIdx === edgeIdx) return;

  const pairEdge = reg.edges[pairIdx];

  if (edge.curve.type === 'line') {
    pairEdge.curve = curveLine();
    return;
  }

  // La curva del paired edge debe ser la misma que la nuestra,
  // pero expresada en coordenadas relativas a SU start.
  const ourStart = reg.vertices[edge.start];
  const pairStart = reg.vertices[pairEdge.start];

  // El punto de control absoluto
  const absCp = add(ourStart, edge.curve.ctrl[0]);

  // Expresado en relativas al start del paired edge
  const relCp = sub(absCp, pairStart);

  pairEdge.curve = { type: 'quadratic', ctrl: [relCp] };
}

/** Resetea la región a su forma rectangular original. */
export function resetRegion(reg: FundamentalRegion): void {
  const w = reg.u.x || 400;
  const h = reg.v.y || 300;
  const cx = (reg.vertices[0].x + reg.vertices[2].x) / 2;
  const cy = (reg.vertices[0].y + reg.vertices[2].y) / 2;
  const halfW = w / 2;
  const halfH = h / 2;

  reg.vertices[0] = vec2(cx - halfW, cy - halfH);
  reg.vertices[1] = vec2(cx + halfW, cy - halfH);
  reg.vertices[2] = vec2(cx + halfW, cy + halfH);
  reg.vertices[3] = vec2(cx - halfW, cy + halfH);

  for (const edge of reg.edges) {
    edge.curve = curveLine();
  }
}

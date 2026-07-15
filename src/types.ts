// ─── Geometría básica ───────────────────────────────────────────────

export interface Vec2 {
  x: number;
  y: number;
}

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// ─── Curvas ─────────────────────────────────────────────────────────

export type CurveType = 'line' | 'quadratic';

/** Curva paramétrica que va de `start` a `end`. */
export interface Curve {
  readonly type: CurveType;
  /** Puntos de control en coordenadas relativas al `start`.
   *  - 'line':       []
   *  - 'quadratic':  [cp]  */
  readonly ctrl: readonly Vec2[];
}

export function curveLine(): Curve {
  return { type: 'line', ctrl: [] };
}

export function curveQuadratic(cp: Vec2): Curve {
  return { type: 'quadratic', ctrl: [cp] };
}

/** Evalúa un punto sobre la curva en t ∈ [0, 1] en coordenadas absolutas. */
export function evalCurve(curve: Curve, start: Vec2, end: Vec2, t: number): Vec2 {
  if (curve.type === 'line') {
    return lerp(start, end, t);
  }
  // quadratic Bézier: B(t) = (1-t)²·P0 + 2(1-t)t·P1 + t²·P2
  const cp = add(start, curve.ctrl[0]);
  const s = 1 - t;
  return {
    x: s * s * start.x + 2 * s * t * cp.x + t * t * end.x,
    y: s * s * start.y + 2 * s * t * cp.y + t * t * end.y,
  };
}

/** Genera el SVG path `d` para una curva. */
export function curveToPath(curve: Curve, start: Vec2, end: Vec2): string {
  const parts = [`M ${start.x} ${start.y}`];
  if (curve.type === 'line') {
    parts.push(`L ${end.x} ${end.y}`);
  } else {
    const cp = add(start, curve.ctrl[0]);
    parts.push(`Q ${cp.x} ${cp.y} ${end.x} ${end.y}`);
  }
  return parts.join(' ');
}

// ─── Transformaciones ──────────────────────────────────────────────

export interface Transform {
  readonly dx: number;
  readonly dy: number;
}

export function applyTransform(p: Vec2, t: Transform): Vec2 {
  return { x: p.x + t.dx, y: p.y + t.dy };
}

export function composeTransforms(a: Transform, b: Transform): Transform {
  return { dx: a.dx + b.dx, dy: a.dy + b.dy };
}

// ─── Región fundamental ────────────────────────────────────────────

export type EdgeId = string;

/**
 * Un borde de la región fundamental.
 * `start` y `end` son índices en `vertices[]` de la región.
 * `pairId` es el id del borde emparejado (el que debe deformarse
 * idénticamente bajo la transformación del grupo).
 */
export interface EdgeDef {
  readonly id: EdgeId;
  start: number;
  end: number;
  curve: Curve;
  /** Id del borde con el que compartimos forma. */
  pairId: EdgeId;
  /** Transformación que lleva nuestra `curve` a la `curve` del paired edge. */
  pairTransform: Transform;
}

/**
 * Región fundamental de una teselación periódica.
 *
 * - `vertices` son los vértices del polígono fundamental.
 * - `edges` son los bordes, en orden de polilínea cerrada.
 * - Cada borde apunta a su `pairId` para que al deformarlo
 *   el borde emparejado se actualice automáticamente.
 * - `u` y `v` son los vectores de traslación del grupo p1.
 */
export interface FundamentalRegion {
  vertices: Vec2[];
  edges: EdgeDef[];
  /** Vector de traslación horizontal. */
  u: Vec2;
  /** Vector de traslación vertical. */
  v: Vec2;
}

// ─── Estados de interacción ────────────────────────────────────────

export type DragTarget =
  | { kind: 'vertex'; vertexIdx: number }
  | { kind: 'control'; edgeIdx: number }
  | { kind: 'edge-create'; edgeIdx: number; pos: Vec2 };

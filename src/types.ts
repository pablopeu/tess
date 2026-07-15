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

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function cross2(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function len(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

export function normalize(v: Vec2): Vec2 {
  const l = len(v);
  if (l === 0) return { x: 0, y: 0 };
  return { x: v.x / l, y: v.y / l };
}

/** Distancia mínima de un punto a un segmento. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const abLen2 = dot(ab, ab);
  if (abLen2 === 0) return dist(p, a);
  let t = dot(sub(p, a), ab) / abLen2;
  t = Math.max(0, Math.min(1, t));
  const proj = add(a, scale(ab, t));
  return dist(p, proj);
}

// ─── Edge / transform ──────────────────────────────────────────────

export type EdgeId = string;

export interface EdgeDef {
  readonly id: EdgeId;
  start: number;
  end: number;
  pairId: EdgeId;
}

export interface Transform {
  readonly dx: number;
  readonly dy: number;
}

// ─── Región fundamental ───────────────────────────────────────────

export interface FundamentalRegion {
  vertices: Vec2[];
  edges: EdgeDef[];
  /** Vector de traslación u (horizontal en modo p1). */
  u: Vec2;
  /** Vector de traslación v (vertical en modo p1). */
  v: Vec2;
  /** true si la región se construyó desde un triángulo. */
  isTriangle?: boolean;
}

// ─── Interacción ──────────────────────────────────────────────────

export type EditorPhase = 'building' | 'editing';

export interface DragState {
  kind: 'vertex';
  vertexIdx: number;
  lastMouse: Vec2;
}

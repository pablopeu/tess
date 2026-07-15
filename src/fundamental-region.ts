import {
  type Vec2, type EdgeDef, type FundamentalRegion,
  vec2, add, sub, len, cross2,
} from './types';

// ─── Constantes ────────────────────────────────────────────────────

const TOLERANCE = 0.01; // para comparaciones de paralelismo

// ─── Resultado de verificación de teselabilidad ────────────────────

export interface TileabilityResult {
  tileable: boolean;
  reason?: string;
  region?: FundamentalRegion;
}

// ─── Verificación de paralelogramo ────────────────────────────────

function areParallel(a: Vec2, b: Vec2): boolean {
  return Math.abs(cross2(a, b)) < TOLERANCE * len(a) * len(b);
}

function areParallelAndEqual(a: Vec2, b: Vec2): boolean {
  return areParallel(a, b) && Math.abs(len(a) - len(b)) < TOLERANCE * (len(a) + len(b)) / 2;
}

// ─── Construcción de región fundamental ───────────────────────────

/**
 * Convierte un triángulo (3 puntos) en el paralelogramo que
 * forma la región fundamental p1.
 *
 * Dados A, B, C (en orden), el cuarto vértice del paralelogramo
 * es D = B + C - A. El orden es A → B → D → C.
 */
function triangleToParallelogram(pts: Vec2[]): Vec2[] {
  const A = pts[0];
  const B = pts[1];
  const C = pts[2];
  const D = add(add(B, C), vec2(-A.x, -A.y)); // B + C - A
  return [A, B, D, C];
}

/**
 * Verifica si los puntos dados forman una figura teselable
 * y devuelve la región fundamental correspondiente.
 */
export function checkTileability(pts: Vec2[]): TileabilityResult {
  if (pts.length < 3) {
    return { tileable: false, reason: 'Se necesitan al menos 3 puntos' };
  }

  if (pts.length === 3) {
    // Todo triángulo tesela el plano (formando un paralelogramo con su reflejo)
    const paraVerts = triangleToParallelogram(pts);
    const region = buildParallelogramRegion(paraVerts, true);
    return { tileable: true, region };
  }

  if (pts.length === 4) {
    // Verificar si es un paralelogramo
    const e0 = sub(pts[1], pts[0]);
    const e2 = sub(pts[2], pts[3]);
    const e1 = sub(pts[2], pts[1]);
    const e3 = sub(pts[0], pts[3]);

    if (!areParallelAndEqual(e0, e2)) {
      return {
        tileable: false,
        reason: 'Los lados opuestos deben ser paralelos y de igual longitud',
      };
    }
    if (!areParallelAndEqual(e1, e3)) {
      return {
        tileable: false,
        reason: 'Los lados opuestos deben ser paralelos y de igual longitud',
      };
    }

    const region = buildParallelogramRegion(pts);
    return { tileable: true, region };
  }

  return {
    tileable: false,
    reason: 'Se requieren 3 (triángulo) o 4 (paralelogramo) puntos',
  };
}

function buildParallelogramRegion(verts: Vec2[], isTriangle = false): FundamentalRegion {
  // verts debe ser [v0, v1, v2, v3] en orden cíclico
  const u = sub(verts[1], verts[0]);
  const v = sub(verts[3], verts[0]);

  // Emparejamientos: edge 0 ↔ edge 2, edge 1 ↔ edge 3
  const edges: EdgeDef[] = [
    { id: 'e0', start: 0, end: 1, pairId: 'e2' },
    { id: 'e1', start: 1, end: 2, pairId: 'e3' },
    { id: 'e2', start: 2, end: 3, pairId: 'e0' },
    { id: 'e3', start: 3, end: 0, pairId: 'e1' },
  ];

  return { vertices: verts, edges, u, v, isTriangle };
}

// ─── Mutación de vértices (manteniendo paralelogramo) ─────────────

const OPPOSITE_MAP: Record<number, number> = { 0: 2, 1: 3, 2: 0, 3: 1 };

/**
 * Mueve un vértice manteniendo la estructura de paralelogramo.
 */
export function moveVertex(region: FundamentalRegion, idx: number, delta: Vec2): void {
  const opp = OPPOSITE_MAP[idx];
  if (opp === undefined) return;

  region.vertices[idx] = add(region.vertices[idx], delta);
  region.vertices[opp] = sub(region.vertices[opp], delta);

  // Recalcular vectores de traslación
  region.u = sub(region.vertices[1], region.vertices[0]);
  region.v = sub(region.vertices[3], region.vertices[0]);
}

// ─── Reset ────────────────────────────────────────────────────────

export function resetRegion(): void {
}

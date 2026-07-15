import {
  type Vec2, type FundamentalRegion,
  add, vec2,
} from './types';

// ─── Datos de teselación ──────────────────────────────────────────

export interface TiledPolygon {
  /** SVG path `d` para este polígono. */
  pathD: string;
  /** true si es uno de los triángulos del usuario (modo triángulo). */
  isPrimary: boolean;
  /** Origen de celda (para normalizar coordenadas en interacción). */
  cellCol: number;
  cellRow: number;
}

export interface TiledVertex {
  pos: Vec2;
  /** Índice en la región fundamental. */
  sourceVertexIdx: number;
  cellCol: number;
  cellRow: number;
}

export interface TilingData {
  polygons: TiledPolygon[];
  vertices: TiledVertex[];
}

// ─── Generación de teselación p1 ──────────────────────────────────

const GRID = 5;

/**
 * Genera una teselación del plano aplicando el grupo p1 (traslaciones
 * puras) a la región fundamental.
 *
 * Si la región proviene de un triángulo (isTriangle), renderiza dos
 * triángulos por celda: el original (vértices 0,1,3 del paralelogramo)
 * y su reflejo (vértices 1,2,3).
 * Si no, renderiza el paralelogramo completo.
 */
export function generateP1Tiling(region: FundamentalRegion): TilingData {
  const polygons: TiledPolygon[] = [];
  const vertices: TiledVertex[] = [];

  const half = Math.floor(GRID / 2);
  const startCol = -half;
  const endCol = startCol + GRID;
  const startRow = -half;
  const endRow = startRow + GRID;

  const v = region.vertices;
  const triVerts = region.isTriangle
    ? [v[0], v[1], v[3]]
    : null;

  for (let row = startRow; row < endRow; row++) {
    for (let col = startCol; col < endCol; col++) {
      const offset = vec2(
        col * region.u.x + row * region.v.x,
        col * region.u.y + row * region.v.y,
      );

      if (triVerts) {
        // Modo triángulo: derivar de los vértices actuales del paralelogramo
        const A = add(triVerts[0], offset);
        const B = add(triVerts[1], offset);
        const C = add(triVerts[2], offset);
        const D = add(v[2], offset); // cuarto vértice del paralelogramo

        // Triángulo primario (el del usuario) — v0→v1→v3
        polygons.push({
          pathD: `M ${A.x} ${A.y} L ${B.x} ${B.y} L ${C.x} ${C.y} Z`,
          isPrimary: true,
          cellCol: col,
          cellRow: row,
        });

        // Triángulo secundario (el reflejo) — v1→v2→v3
        polygons.push({
          pathD: `M ${B.x} ${B.y} L ${D.x} ${D.y} L ${C.x} ${C.y} Z`,
          isPrimary: false,
          cellCol: col,
          cellRow: row,
        });

        vertices.push(
          { pos: A, sourceVertexIdx: 0, cellCol: col, cellRow: row },
          { pos: B, sourceVertexIdx: 1, cellCol: col, cellRow: row },
          { pos: D, sourceVertexIdx: 2, cellCol: col, cellRow: row },
          { pos: C, sourceVertexIdx: 3, cellCol: col, cellRow: row },
        );
      } else {
        // Modo paralelogramo
        const verts = region.vertices.map(p => add(p, offset));
        const d = verts.map(p => `${p.x} ${p.y}`).join(' L ');
        polygons.push({
          pathD: `M ${d} Z`,
          isPrimary: true,
          cellCol: col,
          cellRow: row,
        });

        for (let vi = 0; vi < verts.length; vi++) {
          vertices.push({
            pos: verts[vi],
            sourceVertexIdx: vi,
            cellCol: col,
            cellRow: row,
          });
        }
      }
    }
  }

  return { polygons, vertices };
}

// ─── Hit testing ──────────────────────────────────────────────────

const HIT_RADIUS = 14;

export interface HitResult {
  kind: 'vertex' | 'polygon';
  sourceVertexIdx: number;
  pos: Vec2;
}

/**
 * Encuentra a qué elemento de la teselación corresponde un punto
 * (en coordenadas de región, NO de pantalla).
 *
 * Normaliza las coordenadas a la celda fundamental antes de buscar.
 */
export function hitTest(tiling: TilingData, point: Vec2): HitResult | null {
  // 1) Buscar el vértice más cercano (en cualquier celda).
  //    Normalizamos a coordenadas de la región fundamental restando
  //    el offset de celda.
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
      };
    }
  }

  // Si no hay hit, ver si estamos dentro de algún polígono (para crear un punto)
  // Por ahora devolvemos null si no encontramos un vértice.
  return best;
}

function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

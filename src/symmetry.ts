import {
  type Vec2, type FundamentalRegion,
  add, vec2,
} from './types';
import { getPolygonPoints } from './fundamental-region';

// ─── Datos de teselación ──────────────────────────────────────────

export interface TiledPolygon {
  pathD: string;
  isPrimary: boolean;
  cellCol: number;
  cellRow: number;
}

export interface TiledVertex {
  pos: Vec2;
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
 * Genera una teselación p1 a partir de la región fundamental.
 *
 * Para cada celda, construye el polígono recorriendo los 4 bordes
 * de la región fundamental, incluyendo los puntos de segmento
 * de cada borde. Todos los vértices se trasladan por i*u + j*v.
 */
export function generateP1Tiling(region: FundamentalRegion): TilingData {
  const polygons: TiledPolygon[] = [];
  const vertices: TiledVertex[] = [];

  const half = Math.floor(GRID / 2);
  const startCol = -half;
  const endCol = startCol + GRID;
  const startRow = -half;
  const endRow = startRow + GRID;

  // Obtener los puntos del polígono base (con segmentos)
  const basePts = getPolygonPoints(region);
  const v = region.vertices;

  for (let row = startRow; row < endRow; row++) {
    for (let col = startCol; col < endCol; col++) {
      const offset = vec2(
        col * region.u.x + row * region.v.x,
        col * region.u.y + row * region.v.y,
      );

      if (region.isTriangle) {
        // Triángulo: renderizar dos triángulos por celda
        const A = add(v[0], offset);
        const B = add(v[1], offset);
        const C = add(v[2], offset);
        const D = add(v[3], offset);

        // Triángulo primario A→B→C
        polygons.push({
          pathD: `M ${A.x} ${A.y} L ${B.x} ${B.y} L ${C.x} ${C.y} Z`,
          isPrimary: true,
          cellCol: col,
          cellRow: row,
        });

        // Triángulo secundario A→C→D
        polygons.push({
          pathD: `M ${A.x} ${A.y} L ${C.x} ${C.y} L ${D.x} ${D.y} Z`,
          isPrimary: false,
          cellCol: col,
          cellRow: row,
        });

        // Solo los 4 vértices base para interacción (triangle, no segments)
        vertices.push(
          { pos: A, sourceVertexIdx: 0, cellCol: col, cellRow: row },
          { pos: B, sourceVertexIdx: 1, cellCol: col, cellRow: row },
          { pos: C, sourceVertexIdx: 2, cellCol: col, cellRow: row },
          { pos: D, sourceVertexIdx: 3, cellCol: col, cellRow: row },
        );
      } else {
        // Paralelogramo con segmentos: renderizar el polígono completo
        const cellPts = basePts.map(p => add(p, offset));
        const d = cellPts.map(p => `${p.x} ${p.y}`).join(' L ');
        polygons.push({
          pathD: `M ${d} Z`,
          isPrimary: true,
          cellCol: col,
          cellRow: row,
        });

        for (let vi = 0; vi < basePts.length; vi++) {
          vertices.push({
            pos: cellPts[vi],
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
  kind: 'vertex';
  sourceVertexIdx: number;
  pos: Vec2;
}

export function hitTest(tiling: TilingData, point: Vec2): HitResult | null {
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

  return best;
}

function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

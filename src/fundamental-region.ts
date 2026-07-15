import {
  type Vec2, type EdgeDef, type FundamentalRegion,
  sub, dot, distToSegment,
} from './types';

// ─── Construcción genérica de región fundamental p1 ──────────────

/**
 * Construye una región fundamental p1 desde una lista de vértices.
 * Con 3 vértices: completa el 4º como D = A + C - B (paralelogramo).
 * Con N pares: asume que es un paralelógeno con N/2 pares de bordes opuestos.
 * Con N impar: error (no teselable en p1).
 */
export function buildP1Region(pts: Vec2[]): FundamentalRegion | null {
  const n = pts.length;

  if (n === 3) {
    // Triángulo → paralelogramo [A, B, C, D] con D = A + C - B
    const D = { x: pts[0].x + pts[2].x - pts[1].x, y: pts[0].y + pts[2].y - pts[1].y };
    const verts = [pts[0], pts[1], pts[2], D];
    return buildP1FromVerts(verts, true);
  }

  if (n % 2 !== 0) return null; // impar → no teselable

  return buildP1FromVerts(pts, false);
}

function buildP1FromVerts(verts: Vec2[], isTriangle: boolean): FundamentalRegion {
  const n = verts.length;
  const halfN = n / 2;

  // Vectores de traslación del paralelogramo base
  // u = v[1] - v[0], v = v[n-1] - v[0]
  const u = sub(verts[1], verts[0]);
  const v = sub(verts[n - 1], verts[0]);

  // Crear N bordes con emparejamiento i ↔ (i + halfN) % n
  const edges: EdgeDef[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const pair = (i + halfN) % n;
    edges.push({
      id: `e${i}`,
      start: i,
      end: j,
      pairId: `e${pair}`,
    });
  }

  return { vertices: verts, edges, u, v, isTriangle };
}

// ─── Encontrar borde más cercano ──────────────────────────────────

interface EdgeHit {
  edgeIdx: number;     // índice del borde en la región
  t: number;           // parámetro [0,1] a lo largo del borde
  dist: number;        // distancia al borde
}

/**
 * Encuentra a qué borde del polígono está más cerca `pos`,
 * devolviendo el índice y la fracción t.
 */
export function findNearestEdge(verts: Vec2[], pos: Vec2, threshold = 30): EdgeHit | null {
  let best: EdgeHit | null = null;

  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const d = distToSegment(pos, a, b);

    if (d < threshold && (!best || d < best.dist)) {
      // Calcular t
      const ab = sub(b, a);
      const abLen2 = dot(ab, ab);
      let t = 0;
      if (abLen2 > 0) {
        t = dot(sub(pos, a), ab) / abLen2;
        t = Math.max(0.1, Math.min(0.9, t)); // evitar extremos
      }
      best = { edgeIdx: i, t, dist: d };
    }
  }

  return best;
}

// ─── Subdividir borde ────────────────────────────────────────────

/**
 * Agrega un vértice subdividiendo el borde en `edgeIdx` y su
 * borde opuesto, en la fracción t.
 *
 * verts: los vértices actuales del polígono.
 * edgeIdx: índice del borde a subdividir (en el orden del polígono).
 * t: fracción [0, 1].
 *
 * Devuelve: nuevo array de vértices con 2 vértices insertados.
 */
export function subdivideEdge(
  verts: Vec2[],
  edgeIdx: number,
  t: number,
  pos: Vec2,
): Vec2[] {
  const n = verts.length;
  const halfN = n / 2;
  const oppositeEdgeIdx = (edgeIdx + halfN) % n;

  // Crear el nuevo vértice para edgeIdx (usar pos)
  const newV1 = pos;

  // Crear el vértice para el borde opuesto en la misma fracción t
  const oppA = verts[oppositeEdgeIdx];
  const oppB = verts[(oppositeEdgeIdx + 1) % n];
  const newV2 = {
    x: oppA.x + (oppB.x - oppA.x) * t,
    y: oppA.y + (oppB.y - oppA.y) * t,
  };

  // Insertar del índice más grande al más chico para no desplazar
  const result = [...verts];
  if (edgeIdx > oppositeEdgeIdx) {
    result.splice(edgeIdx + 1, 0, newV1);
    result.splice(oppositeEdgeIdx + 1, 0, newV2);
  } else {
    result.splice(oppositeEdgeIdx + 1, 0, newV2);
    result.splice(edgeIdx + 1, 0, newV1);
  }

  return result;
}

// ─── Mutación de vértices (manteniendo estructura) ────────────────

/**
 * Mueve un vértice. Si es un paralelogramo simple (4 vértices),
 * mueve el opuesto en espejo. Si tiene más vértices, mueve solo
 * ese vértice pero ajusta el opuesto para mantener bordes paralelos.
 */
export function moveVertex(region: FundamentalRegion, idx: number, delta: Vec2): void {
  const verts = region.vertices;
  const n = verts.length;

  if (n === 4) {
    // Paralelogramo simple: mover opuesto en espejo
    const opp = [2, 3, 0, 1][idx];
    verts[idx] = { x: verts[idx].x + delta.x, y: verts[idx].y + delta.y };
    verts[opp] = { x: verts[opp].x - delta.x, y: verts[opp].y - delta.y };
    region.u = sub(verts[1], verts[0]);
    region.v = sub(verts[3], verts[0]);
    return;
  }

  // N vértices: mover el vértice y su opuesto paralelo
  const halfN = n / 2;
  const opp = (idx + halfN) % n;

  verts[idx] = { x: verts[idx].x + delta.x, y: verts[idx].y + delta.y };
  verts[opp] = { x: verts[opp].x + delta.x, y: verts[opp].y + delta.y };

  // Recalcular u, v desde los primeros bordes
  region.u = sub(verts[1], verts[0]);
  region.v = sub(verts[n - 1], verts[0]);
}

// ─── Reset ────────────────────────────────────────────────────────

export function resetRegion(): void {}

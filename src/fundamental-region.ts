import {
  type Vec2, type EdgeDef, type FundamentalRegion,
  sub, dot, distToSegment,
} from './types';

// ─── Construcción inicial p1 ─────────────────────────────────────

/**
 * Construye una región fundamental desde 3 o 4 puntos.
 * Con 3: completa el paralelogramo.
 * Con 4: verifica y usa directamente.
 */
export function buildInitialP1Region(pts: Vec2[]): FundamentalRegion | null {
  const n = pts.length;
  if (n === 3) {
    // Triángulo → paralelogramo [A, B, C, D], D = A + C - B
    const D = { x: pts[0].x + pts[2].x - pts[1].x, y: pts[0].y + pts[2].y - pts[1].y };
    const verts = [pts[0], pts[1], pts[2], D];
    return buildP1FromVerts(verts, true);
  }
  if (n === 4) {
    return buildP1FromVerts([...pts], false);
  }
  return null;
}

function buildP1FromVerts(verts: Vec2[], isTriangle: boolean): FundamentalRegion {
  const n = verts.length;
  const u = sub(verts[1], verts[0]);
  const v = sub(verts[n - 1], verts[0]);

  const edges = makeEdges(n);

  return { vertices: verts, edges, u, v, isTriangle };
}

function makeEdges(n: number): EdgeDef[] {
  const halfN = n / 2;
  const edges: EdgeDef[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const pair = (i + halfN) % n;
    edges.push({ id: `e${i}`, start: i, end: j, pairId: `e${pair}` });
  }
  return edges;
}

// ─── Encontrar borde más cercano ──────────────────────────────────

export interface EdgeHit {
  edgeIdx: number;
  t: number;
  dist: number;
}

export function findNearestEdge(verts: Vec2[], pos: Vec2, threshold = 30): EdgeHit | null {
  let best: EdgeHit | null = null;

  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const d = distToSegment(pos, a, b);

    if (d < threshold && (!best || d < best.dist)) {
      const ab = sub(b, a);
      const abLen2 = dot(ab, ab);
      let t = 0;
      if (abLen2 > 0) {
        t = dot(sub(pos, a), ab) / abLen2;
        t = Math.max(0.1, Math.min(0.9, t));
      }
      best = { edgeIdx: i, t, dist: d };
    }
  }

  return best;
}

// ─── Subdividir borde (directo sobre la región) ──────────────────

/**
 * Subdivide un borde de la región y su opuesto, manteniendo u, v intactos.
 * Modifica region.vertices y region.edges in-place.
 */
export function subdivideRegionEdge(region: FundamentalRegion, edgeIdx: number, t: number): void {
  const verts = region.vertices;
  const n = verts.length;
  const halfN = n / 2;
  const oppEdgeIdx = (edgeIdx + halfN) % n;

  // Proyectar pos sobre el segmento del borde (el clic puede estar cerca pero no exactamente sobre él)
  const edgeA = verts[edgeIdx];
  const edgeB = verts[(edgeIdx + 1) % n];
  const newV1 = {
    x: edgeA.x + (edgeB.x - edgeA.x) * t,
    y: edgeA.y + (edgeB.y - edgeA.y) * t,
  };

  // Vértice opuesto en la misma fracción t
  const oppA = verts[oppEdgeIdx];
  const oppB = verts[(oppEdgeIdx + 1) % n];
  const newV2 = {
    x: oppA.x + (oppB.x - oppA.x) * t,
    y: oppA.y + (oppB.y - oppA.y) * t,
  };

  // Insertar del más grande al más chico para no desplazar índices
  if (edgeIdx > oppEdgeIdx) {
    region.vertices.splice(edgeIdx + 1, 0, newV1);
    region.vertices.splice(oppEdgeIdx + 1, 0, newV2);
  } else {
    region.vertices.splice(oppEdgeIdx + 1, 0, newV2);
    region.vertices.splice(edgeIdx + 1, 0, newV1);
  }

  // Reconstruir edges
  region.edges = makeEdges(region.vertices.length);
}

// ─── Mutación de vértices ────────────────────────────────────────

export function moveVertex(region: FundamentalRegion, idx: number, delta: Vec2): void {
  const verts = region.vertices;
  const n = verts.length;

  if (n === 4) {
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

  // NO recalcular u, v — vienen del paralelogramo base
}

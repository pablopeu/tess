import {
  type Vec2, type FundamentalRegion,
  sub, vec2, dist,
} from './types';
import {
  buildInitialP1Region,
  moveVertex,
  moveSegmentPoint,
  findNearestEdge,
  subdivideEdge,
  getPolygonPoints,
  countSegments,
} from './fundamental-region';
import {
  type TilingData,
  generateP1Tiling, hitTest,
} from './symmetry';

type Phase = 'building' | 'editing';

interface DragInfo {
  kind: 'vertex';
  idx: number;  // índice dentro del array de getPolygonPoints()
  lastMouse: Vec2;
}

interface EditorState {
  phase: Phase;
  points: Vec2[];  // building points (raw click positions, 3 or 4)
  region: FundamentalRegion | null;
  tiling: TilingData;
  dragging: DragInfo | null;
  tileabilityMsg: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export class Editor {
  private svg: SVGSVGElement;
  private state: EditorState;
  private rafId: number | null = null;
  private resizeObserver: ResizeObserver;

  constructor(svgElement: SVGSVGElement) {
    this.svg = svgElement;
    this.state = {
      phase: 'building',
      points: [],
      region: null,
      tiling: { polygons: [], vertices: [] },
      dragging: null,
      tileabilityMsg: 'Haz clic para colocar el primer vértice',
    };
    this.setupEventListeners();
    this.render();
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(this.svg);
  }

  // ─── Coordenadas ──────────────────────────────────────────────

  private center(): Vec2 {
    const r = this.svg.getBoundingClientRect();
    return vec2(r.width / 2, r.height / 2);
  }

  private pageToRegion(clientX: number, clientY: number): Vec2 {
    const ctm = this.svg.getScreenCTM();
    if (ctm) {
      const pt = new DOMPoint(clientX, clientY);
      const userPt = pt.matrixTransform(ctm.inverse());
      const c = this.center();
      return vec2(userPt.x - c.x, userPt.y - c.y);
    }
    return vec2(0, 0);
  }

  // ─── Reconstruir desde puntos ─────────────────────────────────

  private rebuildFromPoints(): void {
    if (this.state.points.length < 3) {
      this.state.region = null;
      this.state.tiling = { polygons: [], vertices: [] };
      return;
    }
    this.state.region = buildInitialP1Region(this.state.points);
    if (this.state.region) {
      this.state.tiling = generateP1Tiling(this.state.region);
      const n = this.state.points.length;
      this.state.tileabilityMsg = n === 3
        ? 'Triángulo — clic para 4º vértice, o clic derecho para finalizar'
        : `${4 + countSegments(this.state.region)} puntos — clic en un borde para subdividir`;
    }
  }

  private scheduleRender(): void {
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        if (this.state.region) {
          this.state.tiling = generateP1Tiling(this.state.region);
        }
        this.render();
      });
    }
  }

  // ─── Render ───────────────────────────────────────────────────

  private render(): void {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    const c = this.center();
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('transform', `translate(${c.x}, ${c.y})`);
    this.svg.appendChild(g);

    // Teselación
    if (this.state.region) {
      for (const poly of this.state.tiling.polygons) {
        const el = document.createElementNS(SVG_NS, 'path');
        el.setAttribute('d', poly.pathD);
        el.setAttribute('class', 'cell');
        g.appendChild(el);
      }
    }

    // Building phase: interactive handles on region polygon
    if (this.state.phase === 'building' && this.state.region) {
      const pts = getPolygonPoints(this.state.region);
      this.drawVertexHandles(g, pts, true);
    }

    // Editing phase: handles on center cell only
    if (this.state.phase === 'editing') {
      for (const v of this.state.tiling.vertices) {
        if (v.cellCol === 0 && v.cellRow === 0) {
          const circle = document.createElementNS(SVG_NS, 'circle');
          circle.setAttribute('cx', String(v.pos.x));
          circle.setAttribute('cy', String(v.pos.y));
          circle.setAttribute('r', '5');
          circle.setAttribute('class', 'vertex-handle');
          circle.dataset.vidx = String(v.sourceVertexIdx);
          g.appendChild(circle);
        }
      }
    }

    // Building phase without region: raw points
    if (this.state.phase === 'building' && !this.state.region && this.state.points.length > 0) {
      const pts = this.state.points;
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', String(pts[i].x));
        line.setAttribute('y1', String(pts[i].y));
        line.setAttribute('x2', String(pts[j].x));
        line.setAttribute('y2', String(pts[j].y));
        line.setAttribute('class', 'build-line');
        g.appendChild(line);
      }
      this.drawVertexHandles(g, pts, false);
    }

    this.updateStatus();
  }

  private drawVertexHandles(g: SVGGElement, pts: Vec2[], numbered: boolean): void {
    for (let i = 0; i < pts.length; i++) {
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(pts[i].x));
      circle.setAttribute('cy', String(pts[i].y));
      circle.setAttribute('r', '6');
      circle.setAttribute('class', 'vertex-build');
      circle.dataset.ptidx = String(i);
      g.appendChild(circle);
    }
    if (numbered) {
      for (let i = 0; i < pts.length; i++) {
        const txt = document.createElementNS(SVG_NS, 'text');
        txt.setAttribute('x', String(pts[i].x + 10));
        txt.setAttribute('y', String(pts[i].y - 10));
        txt.setAttribute('class', 'vertex-label');
        txt.textContent = String(i + 1);
        g.appendChild(txt);
      }
    }
  }

  private updateStatus(): void {
    const el = document.getElementById('status');
    if (!el) return;
    el.textContent = this.state.tileabilityMsg;
  }

  // ─── Eventos ─────────────────────────────────────────────────

  private setupEventListeners(): void {
    this.svg.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.svg.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button === 2) {
      if (this.state.phase === 'building' && this.state.region) {
        this.finalizeBuilding();
      }
      return;
    }
    if (e.button !== 0) return;
    const pos = this.pageToRegion(e.clientX, e.clientY);

    if (this.state.phase === 'building') {
      this.handleBuildPointerDown(pos, e);
      return;
    }

    if (this.state.region) {
      const hit = hitTest(this.state.tiling, pos);
      if (hit && hit.kind === 'vertex') {
        this.state.dragging = { kind: 'vertex', idx: hit.sourceVertexIdx, lastMouse: pos };
        e.preventDefault();
      }
    }
  };

  private handleBuildPointerDown(pos: Vec2, e: PointerEvent): void {
    if (this.state.region) {
      // Si es triángulo y points.length === 3, el próximo clic reemplaza C y completa D
      if (this.state.region.isTriangle && this.state.points.length === 3) {
        this.addBuildPoint(pos);
        return;
      }

      const pts = getPolygonPoints(this.state.region);
      for (let i = 0; i < pts.length; i++) {
        if (dist(pos, pts[i]) < 14) {
          this.state.dragging = { kind: 'vertex', idx: i, lastMouse: pos };
          e.preventDefault();
          return;
        }
      }
      // Click on edge → subdivide
      this.handleSubdivideClick(pos);
      return;
    }

    // No region yet → raw building point
    const pts = this.state.points;
    for (let i = 0; i < pts.length; i++) {
      if (dist(pos, pts[i]) < 14) {
        this.state.dragging = { kind: 'vertex', idx: i, lastMouse: pos };
        e.preventDefault();
        return;
      }
    }
    this.addBuildPoint(pos);
  }

  private handleSubdivideClick(pos: Vec2): void {
    if (!this.state.region) return;
    const hit = findNearestEdge(this.state.region, pos, 40);
    if (!hit) {
      this.state.tileabilityMsg = 'Clic cerca de un borde para subdividir';
      this.scheduleRender();
      return;
    }
    subdivideEdge(this.state.region, hit.edgeIdx, hit.t);
    this.state.tiling = generateP1Tiling(this.state.region);
    const segCount = countSegments(this.state.region);
    this.state.tileabilityMsg = `${4 + segCount} puntos — clic en un borde para subdividir`;
    this.scheduleRender();
  }

  private addBuildPoint(pos: Vec2): void {
    const pts = this.state.points;
    if (pts.length > 0 && dist(pos, pts[pts.length - 1]) < 10) return;

    if (pts.length === 3) {
      const A = pts[0], B = pts[1];
      pts[2] = pos;
      pts.push({ x: A.x + pos.x - B.x, y: A.y + pos.y - B.y });
      this.rebuildFromPoints();
      this.scheduleRender();
      return;
    }

    pts.push(pos);
    if (pts.length === 3) {
      // Triángulo detectado → mostrar teselación
      this.rebuildFromPoints();
      // Pero mantener el 3er punto como lo clickeó el usuario
      // rebuildFromPoints completa el paralelogramo con D = A + C - B
    }
    this.scheduleRender();
  }

  private syncPointsFromRegion(): void {
    if (!this.state.region) return;
    const pts = this.state.points;
    const v = this.state.region.vertices;
    for (let i = 0; i < 4 && i < v.length; i++) {
      pts[i] = v[i];
    }
  }

  private finalizeBuilding(): void {
    if (!this.state.region) return;
    this.state.phase = 'editing';
    this.state.tileabilityMsg = 'Arrastra los vértices para deformar la teselación';
    this.scheduleRender();
  }

  private onPointerMove = (e: PointerEvent): void => {
    const pos = this.pageToRegion(e.clientX, e.clientY);
    const drag = this.state.dragging;
    if (!drag) return;
    const delta = sub(pos, drag.lastMouse);
    if (Math.abs(delta.x) < 0.5 && Math.abs(delta.y) < 0.5) return;

    if (!this.state.region) return;

    if (drag.idx > 3) {
      // Punto de segmento en cualquier fase
      moveSegmentPoint(this.state.region, drag.idx, delta);
    } else {
      // Vértice base (0-3)
      moveVertex(this.state.region, drag.idx, delta);
      this.syncPointsFromRegion();
      this.state.tiling = generateP1Tiling(this.state.region);
    }
    drag.lastMouse = pos;
    this.scheduleRender();
  };

  /**
   * Arrastra un punto de segmento (índice > 3 en el array de polygon points).
   * Los polygon points se generan como:
   *   e0.start → e0.segments → e0.end (=e1.start) → e1.segments → e1.end ...
   * El punto de segmento en polygonPoints[pidx] pertenece a algún edge.
   * Lo mapeamos al edge y movemos el correspondiente punto en el paired edge.
   */

  private onPointerUp = (): void => {
    this.state.dragging = null;
  };

  // ─── API pública ─────────────────────────────────────────────

  reset(): void {
    this.state.phase = 'building';
    this.state.points = [];
    this.state.region = null;
    this.state.tiling = { polygons: [], vertices: [] };
    this.state.dragging = null;
    this.state.tileabilityMsg = 'Haz clic para colocar el primer vértice';
    this.scheduleRender();
  }

  destroy(): void {
    this.svg.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.resizeObserver.disconnect();
  }
}


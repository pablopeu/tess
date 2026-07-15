import {
  type Vec2, type FundamentalRegion,
  sub, vec2, dist,
} from './types';
import {
  buildP1Region,
  moveVertex,
  findNearestEdge,
  subdivideEdge,
} from './fundamental-region';
import {
  type TilingData,
  generateP1Tiling, hitTest,
} from './symmetry';

// ─── Estados del editor ───────────────────────────────────────────

type Phase = 'building' | 'editing';

interface DragInfo {
  kind: 'building-point' | 'tile-vertex';
  idx: number;
  lastMouse: Vec2;
}

interface EditorState {
  phase: Phase;
  points: Vec2[];
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

  // ─── Reconstruir región desde los building points ─────────────

  private rebuildFromPoints(): void {
    const pts = this.state.points;
    if (pts.length < 3) {
      this.state.region = null;
      this.state.tiling = { polygons: [], vertices: [] };
      return;
    }

    const region = buildP1Region(pts);
    if (region) {
      this.state.region = region;
      this.state.tiling = generateP1Tiling(region);
      this.state.tileabilityMsg =
        `${this.describePolygon(pts)} — clic en un borde para subdividir, clic derecho para finalizar`;
    } else {
      this.state.region = null;
      this.state.tiling = { polygons: [], vertices: [] };
      this.state.tileabilityMsg = 'Número impar de vértices — no teselable en p1';
    }
  }

  private describePolygon(pts: Vec2[]): string {
    const n = pts.length;
    if (n === 3) return 'Triángulo';
    if (n === 4) return 'Paralelogramo';
    return `${n} vértices`;
  }

  // ─── Render ───────────────────────────────────────────────────

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
        el.setAttribute('class', poly.isPrimary ? 'cell' : 'cell cell-mirror');
        g.appendChild(el);
      }
    }

    // Building points + líneas de construcción
    if (this.state.phase === 'building' && this.state.points.length > 0) {
      const pts = this.state.points;
      const tileable = this.state.region !== null;

      // Líneas de construcción solo si no hay teselación
      if (!tileable) {
        for (let i = 0; i < pts.length; i++) {
          const j = (i + 1) % pts.length;
          const line = document.createElementNS(SVG_NS, 'line');
          line.setAttribute('x1', String(pts[i].x));
          line.setAttribute('y1', String(pts[i].y));
          line.setAttribute('x2', String(pts[j].x));
          line.setAttribute('y2', String(pts[j].y));
          line.setAttribute('class', 'build-line build-line-invalid');
          g.appendChild(line);
        }
      }

      // Círculos en cada punto
      for (let i = 0; i < pts.length; i++) {
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', String(pts[i].x));
        circle.setAttribute('cy', String(pts[i].y));
        circle.setAttribute('r', '6');
        circle.setAttribute('class', 'vertex-build');
        circle.dataset.ptidx = String(i);
        g.appendChild(circle);
      }

      // Números
      for (let i = 0; i < pts.length; i++) {
        const txt = document.createElementNS(SVG_NS, 'text');
        txt.setAttribute('x', String(pts[i].x + 10));
        txt.setAttribute('y', String(pts[i].y - 10));
        txt.setAttribute('class', 'vertex-label');
        txt.textContent = String(i + 1);
        g.appendChild(txt);
      }
    }

    // Vértices de teselación en editing
    if (this.state.phase === 'editing' && this.state.region) {
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

    this.updateStatus();
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

  private hitBuildPoint(pos: Vec2): number | null {
    const pts = this.state.points;
    for (let i = 0; i < pts.length; i++) {
      if (dist(pos, pts[i]) < 14) return i;
    }
    return null;
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
      const hitIdx = this.hitBuildPoint(pos);
      if (hitIdx !== null) {
        this.state.dragging = { kind: 'building-point', idx: hitIdx, lastMouse: pos };
        e.preventDefault();
        return;
      }
      this.handleBuildClick(pos);
      return;
    }

    if (this.state.region) {
      const hit = hitTest(this.state.tiling, pos);
      if (hit && hit.kind === 'vertex') {
        this.state.dragging = { kind: 'tile-vertex', idx: hit.sourceVertexIdx, lastMouse: pos };
        e.preventDefault();
      }
    }
  };

  private handleBuildClick(pos: Vec2): void {
    const pts = this.state.points;
    if (pts.length > 0 && dist(pos, pts[pts.length - 1]) < 10) return;

    if (pts.length === 3) {
      // 4º clic: reemplazar C con la posición clickeada y completar paralelogramo
      const A = pts[0], B = pts[1];
      pts[2] = pos;
      pts.push({ x: A.x + pos.x - B.x, y: A.y + pos.y - B.y });
      this.rebuildFromPoints();
      this.scheduleRender();
      return;
    }

    if (pts.length >= 4) {
      // 5+ clicks: subdividir el borde más cercano
      const hit = findNearestEdge(pts, pos, 40);
      if (!hit) {
        this.state.tileabilityMsg = 'Clic cerca de un borde para subdividir';
        this.scheduleRender();
        return;
      }
      const newVerts = subdivideEdge(pts, hit.edgeIdx, hit.t, pos);
      this.state.points = newVerts;
      this.rebuildFromPoints();
      this.scheduleRender();
      return;
    }

    // 1-2 puntos: simplemente agregar
    pts.push(pos);
    this.rebuildFromPoints();
    this.scheduleRender();
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

    if (drag.kind === 'building-point') {
      this.dragBuildPoint(drag.idx, pos, delta);
      drag.lastMouse = pos;
      this.scheduleRender();
    } else if (drag.kind === 'tile-vertex' && this.state.region) {
      moveVertex(this.state.region, drag.idx, delta);
      drag.lastMouse = pos;
      this.scheduleRender();
    }
  };

  private dragBuildPoint(idx: number, pos: Vec2, delta: Vec2): void {
    const pts = this.state.points;

    if (pts.length <= 3) {
      pts[idx] = pos;
      this.rebuildFromPoints();
      return;
    }

    // Mover a través de la región
    if (this.state.region) {
      moveVertex(this.state.region, idx, delta);
      const v = this.state.region.vertices;
      for (let i = 0; i < v.length; i++) pts[i] = v[i];
      this.state.tiling = generateP1Tiling(this.state.region);
    }
  }

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

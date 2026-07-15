import {
  type Vec2, type FundamentalRegion,
  sub, vec2, dist,
} from './types';
import {
  checkTileability,
  moveVertex,
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
  points: Vec2[];              // puntos clickeados por el usuario
  region: FundamentalRegion | null;
  tiling: TilingData;
  dragging: DragInfo | null;
  tileabilityMsg: string;
}

// ─── Clase Editor ──────────────────────────────────────────────────

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

  // ─── Re-validar teselabilidad desde los building points ─────────

  private recheckTileability(): void {
    const pts = this.state.points;
    if (pts.length >= 3) {
      const result = checkTileability(pts);
      if (result.tileable && result.region) {
        this.state.region = result.region;
        this.state.tiling = generateP1Tiling(result.region);
        this.state.tileabilityMsg = `¡Teselable! (${pts.length} vértices) — clic derecho para finalizar`;
        return;
      }
    }
    // No tileable: limpiar región para no mostrar teselado viejo
    this.state.region = null;
    this.state.tiling = { polygons: [], vertices: [] };
    if (pts.length >= 3) {
      this.state.tileabilityMsg = 'No teselable — arrastra los puntos para ajustar';
    }
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

    // ── Teselación (solo si hay región válida) ──
    if (this.state.region) {
      for (const poly of this.state.tiling.polygons) {
        const el = document.createElementNS(SVG_NS, 'path');
        el.setAttribute('d', poly.pathD);
        el.setAttribute('class', poly.isPrimary ? 'cell' : 'cell cell-mirror');
        g.appendChild(el);
      }

      // Vértices de la teselación (solo celda central en editing)
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
    }

    // ── Puntos en construcción (siempre en building) ──
    if (this.state.phase === 'building' && this.state.points.length > 0) {
      const pts = this.state.points;
      const tileable = this.state.region !== null;

      // Líneas de construcción
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', String(pts[i].x));
        line.setAttribute('y1', String(pts[i].y));
        line.setAttribute('x2', String(pts[j].x));
        line.setAttribute('y2', String(pts[j].y));
        line.setAttribute('class', tileable ? 'build-line' : 'build-line build-line-invalid');
        g.appendChild(line);
      }

      // Círculos en cada punto (todos arrastrables)
      for (let i = 0; i < pts.length; i++) {
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', String(pts[i].x));
        circle.setAttribute('cy', String(pts[i].y));
        circle.setAttribute('r', '6');
        circle.setAttribute('class', 'vertex-build');
        circle.dataset.ptidx = String(i);
        g.appendChild(circle);
      }

      // Números de orden
      for (let i = 0; i < pts.length; i++) {
        const txt = document.createElementNS(SVG_NS, 'text');
        txt.setAttribute('x', String(pts[i].x + 10));
        txt.setAttribute('y', String(pts[i].y - 10));
        txt.setAttribute('class', 'vertex-label');
        txt.textContent = String(i + 1);
        g.appendChild(txt);
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
    const RADIUS = 14;
    for (let i = 0; i < pts.length; i++) {
      if (dist(pos, pts[i]) < RADIUS) return i;
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
      // Intentar arrastrar un punto existente
      const hitIdx = this.hitBuildPoint(pos);
      if (hitIdx !== null) {
        this.state.dragging = { kind: 'building-point', idx: hitIdx, lastMouse: pos };
        e.preventDefault();
        return;
      }
      // Si no, agregar un nuevo punto
      this.handleBuildClick(pos);
      return;
    }

    // Editing: arrastrar vértice de la teselación
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

    pts.push(pos);
    this.recheckTileability();
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
      // Arrastrar un punto en construcción
      this.state.points[drag.idx] = pos;
      this.recheckTileability();
      drag.lastMouse = pos;
      this.scheduleRender();
    } else if (drag.kind === 'tile-vertex' && this.state.region) {
      moveVertex(this.state.region, drag.idx, delta);
      drag.lastMouse = pos;
      this.scheduleRender();
    }
  };

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

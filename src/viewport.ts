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

interface EditorState {
  phase: Phase;
  points: Vec2[];              // puntos clickeados por el usuario
  region: FundamentalRegion | null;
  tiling: TilingData;
  dragging: { vertexIdx: number; lastMouse: Vec2 } | null;
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

  /** De coordenadas de página a coordenadas de región. */
  private pageToRegion(clientX: number, clientY: number): Vec2 {
    const ctm = this.svg.getScreenCTM();
    if (ctm) {
      // DOMPoint con coordenadas absolutas de pantalla → CTM inversa → SVG user space
      const pt = new DOMPoint(clientX, clientY);
      const userPt = pt.matrixTransform(ctm.inverse());
      const c = this.center();
      return vec2(userPt.x - c.x, userPt.y - c.y);
    }
    return vec2(0, 0);
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

    // ── Teselación (si existe) ──
    for (const poly of this.state.tiling.polygons) {
      const el = document.createElementNS(SVG_NS, 'path');
      el.setAttribute('d', poly.pathD);
      if (poly.isPrimary) {
        el.setAttribute('class', 'cell');
      } else {
        // Triángulo reflejado: menos opaco
        el.setAttribute('class', 'cell cell-mirror');
      }
      g.appendChild(el);
    }

    // ── Vértices de la teselación ──
    for (const v of this.state.tiling.vertices) {
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(v.pos.x));
      circle.setAttribute('cy', String(v.pos.y));
      circle.setAttribute('r', '5');
      // Solo los de la celda central son interactuables
      if (v.cellCol === 0 && v.cellRow === 0) {
        circle.setAttribute('class', 'vertex-handle');
        circle.dataset.vidx = String(v.sourceVertexIdx);
      } else {
        circle.setAttribute('class', 'vertex-inactive');
      }
      g.appendChild(circle);
    }

    // ── Puntos en construcción (building phase) ──
    if (this.state.phase === 'building') {
      const pts = this.state.points;

      // Líneas de construcción
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

      // Círculos en cada punto
      for (let i = 0; i < pts.length; i++) {
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', String(pts[i].x));
        circle.setAttribute('cy', String(pts[i].y));
        circle.setAttribute('r', '6');
        circle.setAttribute('class', pts.length >= 3 && i < 3 ? 'vertex-handle' : 'vertex-build');
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

    // ── Estado ──
    this.updateStatus();
  }

  private updateStatus(): void {
    const el = document.getElementById('status');
    if (!el) return;

    if (this.state.phase === 'building') {
      el.textContent = this.state.tileabilityMsg;
    } else {
      el.textContent = 'Arrastra los vértices para deformar la teselación';
    }
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
      // Botón derecho → finalizar construcción
      if (this.state.phase === 'building' && this.state.points.length >= 3) {
        this.finalizeBuilding();
      }
      return;
    }
    if (e.button !== 0) return;

    const pos = this.pageToRegion(e.clientX, e.clientY);

    if (this.state.phase === 'building') {
      this.handleBuildClick(pos);
      return;
    }

    // Editing: hit test para drag de vértice
    if (this.state.region) {
      const hit = hitTest(this.state.tiling, pos);
      if (hit && hit.kind === 'vertex') {
        this.state.dragging = { vertexIdx: hit.sourceVertexIdx, lastMouse: pos };
        e.preventDefault();
      }
    }
  };

  private handleBuildClick(pos: Vec2): void {
    const pts = this.state.points;

    // Evitar puntos demasiado cercanos
    if (pts.length > 0 && dist(pos, pts[pts.length - 1]) < 10) return;

    pts.push(pos);

    if (pts.length >= 3) {
      const result = checkTileability(pts);
      if (result.tileable && result.region) {
        this.state.region = result.region;
        this.state.tiling = generateP1Tiling(result.region);
        this.state.tileabilityMsg = `¡Teselable! (${pts.length} vértices) — clic derecho para finalizar`;
      } else {
        this.state.tileabilityMsg = result.reason || 'No teselable';
      }
    } else {
      this.state.tileabilityMsg = `Punto ${pts.length} — sigue agregando vértices`;
    }

    this.scheduleRender();
  }

  private finalizeBuilding(): void {
    if (!this.state.region) {
      // Si no hay región teselable, no podemos finalizar
      return;
    }
    this.state.phase = 'editing';
    this.state.tileabilityMsg = '';
    this.scheduleRender();
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.state.dragging) return;
    const pos = this.pageToRegion(e.clientX, e.clientY);
    const drag = this.state.dragging;
    const region = this.state.region;
    if (!region) return;

    const delta = sub(pos, drag.lastMouse);
    if (Math.abs(delta.x) < 0.5 && Math.abs(delta.y) < 0.5) return;

    moveVertex(region, drag.vertexIdx, delta);
    drag.lastMouse = pos;
    this.scheduleRender();
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

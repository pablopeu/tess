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

// ─── Constantes ───────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

// ─── Helpers ──────────────────────────────────────────────────────

/** D = A + C - B, 4º vértice para un paralelogramo [A, B, C, D] */
function parallelogramD(A: Vec2, B: Vec2, C: Vec2): Vec2 {
  return { x: A.x + C.x - B.x, y: A.y + C.y - B.y };
}

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
    if (pts.length === 3) {
      // Triángulo: siempre teselable
      const result = checkTileability(pts);
      if (result.region) {
        this.state.region = result.region;
        this.state.tiling = generateP1Tiling(result.region);
        this.state.tileabilityMsg = 'Triángulo — clic para 4º vértice, o clic derecho para finalizar';
      }
    } else if (pts.length === 4) {
      // Paralelogramo auto-completado: debería ser siempre válido
      const result = checkTileability(pts);
      if (result.tileable && result.region) {
        this.state.region = result.region;
        this.state.tiling = generateP1Tiling(result.region);
        this.state.tileabilityMsg = 'Paralelogramo — clic derecho para finalizar';
      } else {
        // No debería ocurrir nunca porque el 4º se auto-completa
        this.state.region = null;
        this.state.tiling = { polygons: [], vertices: [] };
        this.state.tileabilityMsg = 'Error inesperado';
      }
    } else {
      this.state.region = null;
      this.state.tiling = { polygons: [], vertices: [] };
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

    // ── Teselación ──
    if (this.state.region) {
      for (const poly of this.state.tiling.polygons) {
        const el = document.createElementNS(SVG_NS, 'path');
        el.setAttribute('d', poly.pathD);
        el.setAttribute('class', poly.isPrimary ? 'cell' : 'cell cell-mirror');
        g.appendChild(el);
      }

      // Vértices de la teselación (solo en editing, y solo celda central)
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

    // ── Puntos en construcción ──
    if (this.state.phase === 'building' && this.state.points.length > 0) {
      const pts = this.state.points;
      const tileable = this.state.region !== null;

      // Líneas de construcción: solo cuando NO hay teselación
      // (cuando hay teselación, los bordes ya se ven en los polígonos)
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

      // Círculos arrastrables en cada punto (siempre)
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
      const hitIdx = this.hitBuildPoint(pos);
      if (hitIdx !== null) {
        this.state.dragging = { kind: 'building-point', idx: hitIdx, lastMouse: pos };
        e.preventDefault();
        return;
      }
      this.handleBuildClick(pos);
      return;
    }

    // Editing
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
      // 4º clic: usar la posición clickeada como 3er vértice
      // y completar el paralelogramo. pts = [A, B, C_antiguo]
      // Reemplazamos C_antiguo por el click y calculamos D.
      const A = pts[0];
      const B = pts[1];
      pts[2] = pos;           // C = posición del click
      pts.push(parallelogramD(A, B, pos));  // D = B + C - A
    } else if (pts.length >= 4) {
      return;
    } else {
      pts.push(pos);
    }

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
      this.dragBuildPoint(drag.idx, pos, delta);
      drag.lastMouse = pos;
      this.scheduleRender();
    } else if (drag.kind === 'tile-vertex' && this.state.region) {
      moveVertex(this.state.region, drag.idx, delta);
      drag.lastMouse = pos;
      this.scheduleRender();
    }
  };

  /**
   * Arrastrar un punto en construcción.
   * Con ≤3 puntos: arrastre libre, se re-evalúa teselabilidad.
   * Con 4 puntos: el paralelogramo se mantiene usando moveVertex.
   */
  private dragBuildPoint(idx: number, pos: Vec2, delta: Vec2): void {
    const pts = this.state.points;

    if (pts.length <= 3) {
      pts[idx] = pos;
      this.recheckTileability();
      return;
    }

    // 4 puntos: mantener paralelogramo via moveVertex
    // pts = [A, B, D, C] mismo orden que region.vertices
    if (this.state.region) {
      moveVertex(this.state.region, idx, delta);
      // Sincronizar building points desde región actualizada
      const v = this.state.region.vertices;
      pts[0] = v[0];
      pts[1] = v[1];
      pts[2] = v[2];
      pts[3] = v[3];
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

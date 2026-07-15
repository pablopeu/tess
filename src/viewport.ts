import {
  type Vec2,
  add, sub, vec2,
} from './types';
import {
  createRectangularRegion,
  moveVertex, bendEdge, moveControlPoint, resetRegion,
} from './fundamental-region';
import {
  type TilingData,
  generateP1Tiling, hitTest,
} from './symmetry';

// ─── Constantes de render ──────────────────────────────────────────

const GRID_COLS = 5;
const GRID_ROWS = 5;

// ─── Estado del editor ─────────────────────────────────────────────

interface DragInfo {
  kind: 'vertex' | 'control';
  sourceVertexIdx?: number;
  sourceEdgeIdx?: number;
  /** Offset de celda para normalizar coordenadas a la región fundamental. */
  cellOffset: Vec2;
  lastMouse: Vec2;
}

interface EditorState {
  region: ReturnType<typeof createRectangularRegion>;
  tiling: TilingData;
  dragging: DragInfo | null;
  highlightedEdge: number | null;
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
      region: createRectangularRegion(),
      tiling: { edges: [], vertices: [], controlPoints: [] },
      dragging: null,
      highlightedEdge: null,
    };

    this.state.tiling = generateP1Tiling(this.state.region, GRID_COLS, GRID_ROWS);

    this.setupEventListeners();
    this.render();

    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(this.svg);
  }

  // ─── Sistema de coordenadas ──────────────────────────────────────
  //
  // La región fundamental vive en su propio espacio de coordenadas
  // centrado en (0, 0). El tiling se genera en ese mismo espacio.
  //
  // Para mostrarlo, trasladamos todo al centro del SVG.
  // El offset es simplemente (svgWidth/2, svgHeight/2).

  private svgCenter(): Vec2 {
    const r = this.svg.getBoundingClientRect();
    return vec2(r.width / 2, r.height / 2);
  }

  /** Convierte coordenadas del puntero a espacio de región. */
  private svgToRegion(clientX: number, clientY: number): Vec2 {
    const rect = this.svg.getBoundingClientRect();
    const pt = this.svg.createSVGPoint();
    pt.x = clientX - rect.left;
    pt.y = clientY - rect.top;
    const ctm = this.svg.getScreenCTM();
    if (ctm) {
      const root = pt.matrixTransform(ctm.inverse());
      const c = this.svgCenter();
      return vec2(root.x - c.x, root.y - c.y);
    }
    return vec2(pt.x, pt.y);
  }

  /** Offset de celda para normalizar coordenadas a la región fundamental. */
  private cellOffset(col: number, row: number): Vec2 {
    const u = this.state.region.u;
    const v = this.state.region.v;
    return vec2(col * u.x + row * v.x, col * u.y + row * v.y);
  }

  // ─── Ciclo de render ─────────────────────────────────────────────

  private scheduleRender(): void {
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.state.tiling = generateP1Tiling(this.state.region, GRID_COLS, GRID_ROWS);
        this.render();
      });
    }
  }

  private render(): void {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);

    const tiling = this.state.tiling;
    const c = this.svgCenter();

    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('transform', `translate(${c.x}, ${c.y})`);
    this.svg.appendChild(g);

    // Bordes
    for (const edge of tiling.edges) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', edge.pathD);
      path.dataset.edgeIdx = String(edge.sourceEdgeIdx);

      if (this.state.highlightedEdge !== null && edge.sourceEdgeIdx === this.state.highlightedEdge) {
        path.setAttribute('class', 'cell cell-pair-highlight');
      } else {
        path.setAttribute('class', 'cell');
      }

      g.appendChild(path);
    }

    // Líneas de control (start → control point)
    for (const cp of tiling.controlPoints) {
      const edge = this.state.region.edges[cp.sourceEdgeIdx];
      const start = add(
        this.state.region.vertices[edge.start],
        this.cellOffset(cp.cellCol, cp.cellRow),
      );

      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', String(start.x));
      line.setAttribute('y1', String(start.y));
      line.setAttribute('x2', String(cp.pos.x));
      line.setAttribute('y2', String(cp.pos.y));
      line.setAttribute('class', 'control-line');
      g.appendChild(line);
    }

    // Puntos de control
    for (const cp of tiling.controlPoints) {
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(cp.pos.x));
      circle.setAttribute('cy', String(cp.pos.y));
      circle.setAttribute('r', '6');
      circle.setAttribute('class', 'control-handle');
      circle.dataset.edgeIdx = String(cp.sourceEdgeIdx);
      g.appendChild(circle);
    }

    // Vértices
    for (const v of tiling.vertices) {
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(v.pos.x));
      circle.setAttribute('cy', String(v.pos.y));
      circle.setAttribute('r', '5');
      circle.setAttribute('class', 'vertex-handle');
      circle.dataset.vidx = String(v.sourceVertexIdx);
      g.appendChild(circle);
    }
  }

  // ─── Eventos ─────────────────────────────────────────────────────

  private setupEventListeners(): void {
    this.svg.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const pos = this.svgToRegion(e.clientX, e.clientY);
    const hit = hitTest(this.state.tiling, pos);
    if (!hit) return;

    if (hit.kind === 'vertex' && hit.sourceVertexIdx !== undefined) {
      this.state.dragging = {
        kind: 'vertex',
        sourceVertexIdx: hit.sourceVertexIdx,
        cellOffset: this.cellOffset(hit.cellCol, hit.cellRow),
        lastMouse: pos,
      };
      e.preventDefault();
    } else if (hit.kind === 'control' && hit.sourceEdgeIdx !== undefined) {
      this.state.dragging = {
        kind: 'control',
        sourceEdgeIdx: hit.sourceEdgeIdx,
        cellOffset: this.cellOffset(hit.cellCol, hit.cellRow),
        lastMouse: pos,
      };
      e.preventDefault();
    } else if (hit.kind === 'edge' && hit.sourceEdgeIdx !== undefined) {
      const edge = this.state.region.edges[hit.sourceEdgeIdx];
      if (edge.curve.type === 'line') {
        // Normalizar a coordenadas de la celda fundamental
        const offset = this.cellOffset(hit.cellCol, hit.cellRow);
        const fundamentalPos = sub(pos, offset);
        bendEdge(this.state.region, hit.sourceEdgeIdx, fundamentalPos);
        this.scheduleRender();
      }
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const pos = this.svgToRegion(e.clientX, e.clientY);
    const drag = this.state.dragging;

    if (!drag) {
      // Hover highlight
      const hit = hitTest(this.state.tiling, pos);
      let hl: number | null = null;
      if (hit) {
        if (hit.kind === 'edge') hl = hit.sourceEdgeIdx ?? null;
        if (hit.kind === 'control') hl = hit.sourceEdgeIdx ?? null;
      }
      if (hl !== this.state.highlightedEdge) {
        this.state.highlightedEdge = hl;
        this.scheduleRender();
      }
      return;
    }

    const delta = sub(pos, drag.lastMouse);
    if (Math.abs(delta.x) < 0.5 && Math.abs(delta.y) < 0.5) return;

    if (drag.kind === 'vertex' && drag.sourceVertexIdx !== undefined) {
      moveVertex(this.state.region, drag.sourceVertexIdx, delta);
    } else if (drag.kind === 'control' && drag.sourceEdgeIdx !== undefined) {
      // Normalizar la posición del ratón a la celda fundamental
      const fundamentalPos = sub(pos, drag.cellOffset);
      moveControlPoint(this.state.region, drag.sourceEdgeIdx, fundamentalPos);
    }

    drag.lastMouse = pos;
    this.scheduleRender();
  };

  private onPointerUp = (): void => {
    this.state.dragging = null;
  };

  // ─── API pública ─────────────────────────────────────────────────

  reset(): void {
    resetRegion(this.state.region);
    this.state.highlightedEdge = null;
    this.scheduleRender();
  }

  destroy(): void {
    this.svg.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.resizeObserver.disconnect();
  }
}

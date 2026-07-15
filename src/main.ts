import { Editor } from './viewport';
import './style.css';

function main(): void {
  const svg = document.getElementById('viewport') as SVGSVGElement | null;
  if (!svg) {
    console.error('No se encontró el elemento #viewport');
    return;
  }

  const editor = new Editor(svg);

  const resetBtn = document.getElementById('btn-reset');
  resetBtn?.addEventListener('click', () => {
    editor.reset();
  });

  // Exponer editor para debugging
  (window as any).__editor = editor;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}

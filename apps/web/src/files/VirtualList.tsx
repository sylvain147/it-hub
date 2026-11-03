import { useState, type ReactNode } from 'react';

/** Liste virtualisée à hauteur de ligne fixe : seules les lignes visibles sont rendues (gros fichiers). */
export function VirtualList({ count, rowHeight, height, render, className }: { count: number; rowHeight: number; height: number; render: (i: number) => ReactNode; className?: string }) {
  const [top, setTop] = useState(0);
  const first = Math.max(0, Math.floor(top / rowHeight) - 10);
  const last = Math.min(count, Math.ceil((top + height) / rowHeight) + 10);
  const rows: ReactNode[] = [];
  for (let i = first; i < last; i++) {
    rows.push(
      <div key={i} style={{ position: 'absolute', top: i * rowHeight, left: 0, right: 0, height: rowHeight }}>
        {render(i)}
      </div>,
    );
  }
  return (
    <div className={className} style={{ height, overflow: 'auto', position: 'relative' }} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      <div style={{ height: count * rowHeight, position: 'relative', minWidth: 'max-content' }}>{rows}</div>
    </div>
  );
}

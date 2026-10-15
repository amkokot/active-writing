import { ArrowDown, ArrowUp } from "lucide-react";

export function BlockWindowBar({ index, total, radius, disabled, onMove, onRadius }: {
  index: number; total: number; radius: number; disabled: boolean;
  onMove: (direction: -1 | 1) => void; onRadius: (radius: number) => void;
}) {
  return <div className="block-window-bar" aria-label="Block window navigation">
    <button aria-label="Previous block" title="Previous block · doesn't check anything off" disabled={disabled || !total || index === 0} onClick={() => onMove(-1)}><ArrowUp size={13} /></button>
    <span role="status">Block {total ? index + 1 : 0} / {total}</span>
    <button aria-label="Next block" title="Next block · doesn't check anything off" disabled={disabled || !total || index >= total - 1} onClick={() => onMove(1)}><ArrowDown size={13} /></button>
    <label>Window <select aria-label="Block window size" value={radius} onChange={event => onRadius(Number(event.target.value))}>
      <option value={0}>1 block</option><option value={1}>3 blocks</option><option value={2}>5 blocks</option><option value={4}>9 blocks</option>
    </select></label>
    <small title="Scroll the source strip to move focus. Faded neighbors are context, not part of the preview or compile window. Nothing is checked off.">Scroll to focus · no checks</small>
  </div>;
}

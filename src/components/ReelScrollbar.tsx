import { useRef } from "react";

/** Global block progress; independent of the bounded reel's local scroll height. */
export function ReelScrollbar({ index, total, visible, disabled, onNavigate }: { index: number; total: number; visible: number; disabled: boolean; onNavigate: (index: number) => void }) {
  const grab = useRef(0);
  const size = Math.min(1, Math.max(0.025, visible / Math.max(1, total)));
  const fraction = index / Math.max(1, total - 1);
  const move = (clientY: number, track: HTMLElement) => {
    const bounds = track.getBoundingClientRect(), thumb = Math.max(18, size * bounds.height);
    const progress = Math.max(0, Math.min(1, (clientY - bounds.top - grab.current) / Math.max(1, bounds.height - thumb)));
    onNavigate(Math.round(progress * Math.max(0, total - 1)));
  };
  return <div className="reel-scrollbar" role="scrollbar" aria-label="Position in whole paper" aria-orientation="vertical" aria-valuemin={1} aria-valuemax={Math.max(1, total)} aria-valuenow={index + 1} aria-valuetext={`Block ${index + 1} of ${total}`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
    title={`Block ${index + 1} of ${total} · drag to navigate the whole paper`}
    onPointerDown={event => {
      if (disabled) return;
      event.preventDefault(); const track = event.currentTarget, thumb = track.firstElementChild!.getBoundingClientRect();
      grab.current = event.target === track.firstElementChild ? event.clientY - thumb.top : thumb.height / 2;
      track.setPointerCapture(event.pointerId); move(event.clientY, track);
    }}
    onPointerMove={event => { if (!disabled && event.currentTarget.hasPointerCapture(event.pointerId)) move(event.clientY, event.currentTarget); }}
    onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onKeyDown={event => {
      if (disabled || !["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); onNavigate(Math.max(0, Math.min(total - 1, event.key === "Home" ? 0 : event.key === "End" ? total - 1 : index + (event.key.endsWith("Up") ? -1 : 1) * (event.key.startsWith("Page") ? Math.max(1, visible) : 1))));
    }}>
    <div className="reel-scroll-thumb" style={{ height: `${size * 100}%`, top: `calc(${fraction * 100}% - max(18px, ${size * 100}%) * ${fraction})` }} />
  </div>;
}

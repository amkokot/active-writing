import { useEffect, useRef, useState } from "react";

export function PaneZoomIndicator({ zoom, label, onReset }: { zoom: number; label: string; onReset: () => void }) {
  const previous = useRef(zoom);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (previous.current === zoom) return;
    previous.current = zoom; setVisible(true);
    const timer = setTimeout(() => setVisible(false), 1800);
    return () => clearTimeout(timer);
  }, [zoom]);
  return visible ? <button className="pane-zoom-indicator" aria-label={`Reset ${label} zoom to 100%`} title="Click to reset · Ctrl/⌘ + 0" onClick={onReset}>{Math.round(zoom * 100)}%</button> : null;
}

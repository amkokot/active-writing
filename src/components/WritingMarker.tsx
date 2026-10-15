import { LockKeyhole, SquarePen } from "lucide-react";
import type { WritingMarker as Marker } from "../writing";

export function WritingMarker({ marker, onOpen }: { marker?: Marker; onOpen?: (id: string) => void }) {
  return marker ? <button className={`writing-marker${marker.locked ? " is-locked" : ""}`} aria-label={marker.label} title={marker.locked ? "Human-reviewed wording · open to deliberately unlock" : "Open this paragraph's pending writing review"} onClick={() => onOpen?.(marker.taskId)}>{marker.locked ? <LockKeyhole size={10} /> : <SquarePen size={10} />}{marker.label}</button> : null;
}

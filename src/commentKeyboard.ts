type CommentKey = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; repeat?: boolean; isComposing?: boolean };

export function isNewCommentShortcut(event: CommentKey) {
  return !event.isComposing && !event.repeat && !event.shiftKey && !event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "m";
}

/** Explicit save/navigation only; ordinary Enter and arrow selection stay native. */
export function commentShortcut(event: CommentKey, replies = false): "save" | -1 | 1 | undefined {
  if (event.isComposing || event.repeat || event.altKey) return;
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.shiftKey) return "save";
  if (!replies || !event.shiftKey || event.ctrlKey || event.metaKey) return;
  if (event.key === "ArrowUp" || event.key === "ArrowLeft") return -1;
  if (event.key === "ArrowDown" || event.key === "ArrowRight") return 1;
}

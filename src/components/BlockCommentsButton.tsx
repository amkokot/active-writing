import { MessageSquareText } from "lucide-react";

/** A saved annotation indicator, distinct from creating a new comment. */
export function BlockCommentsButton({ blockId, count, onOpen }: { blockId: string; count?: number; onOpen?: (id: string) => void }) {
  if (!count || !onOpen) return null;
  return <button className="block-comments-indicator" data-comment-block={blockId} aria-label={`Show ${count} comment${count === 1 ? "" : "s"} on this block`} title="Open this block's comments" onMouseDown={event => event.preventDefault()} onClick={() => onOpen(blockId)}>
    <MessageSquareText size={15} /><span>{count}</span>
  </button>;
}

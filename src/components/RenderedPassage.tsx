import { Component, memo, useEffect, useState } from "react";
import { ReplyMarkdown, type ReplyMarkdownProps } from "../replyMarkdown";
import { useStableEvent } from "../useStableEvent";
import "katex/dist/katex.min.css";

/** Safe reading approximation. Never substitutes for the project's TeX compiler. */
class PassageBoundary extends Component<ReplyMarkdownProps, { source: boolean }> {
  state = { source: false };
  static getDerivedStateFromError() { return { source: true }; }
  componentDidUpdate(previous: { text: string }) { if (previous.text !== this.props.text && this.state.source) this.setState({ source: false }); }
  render() {
    return this.state.source ? <div className="unrendered-passage"><p>{this.props.text}</p><small>This passage is shown as source. Other passages remain rendered.</small></div> : <ReplyMarkdown {...this.props} />;
  }
}

interface PassageProps extends ReplyMarkdownProps {
  paragraphId?: string;
  onPassageReference?: (paragraphId: string, token: Parameters<NonNullable<ReplyMarkdownProps["onReference"]>>[0]) => void;
}
export default memo(function RenderedPassage(props: PassageProps) {
  const identity = `${props.figureContext?.projectId ?? ""}:${props.figureContext?.revision ?? ""}`;
  const [shown, setShown] = useState({identity, text: props.text});
  useEffect(() => {
    if (shown.identity !== identity) { setShown({identity, text: props.text}); return; }
    if (shown.text === props.text) return;
    // Source and recovery stay immediate. Rebuilding a long theorem's math on
    // every character competes with the caret even if other passages are memoized.
    const timer = setTimeout(() => setShown({identity, text: props.text}), 180);
    return () => clearTimeout(timer);
  }, [identity, props.text, shown.identity, shown.text]);
  // Parent closures change while a different paragraph is typed into. Preserve
  // Markdown's memo boundary while clicks still use the latest committed handler.
  const onReference = useStableEvent((...args: Parameters<NonNullable<ReplyMarkdownProps["onReference"]>>) => props.paragraphId && props.onPassageReference ? props.onPassageReference(props.paragraphId,args[0]) : props.onReference?.(...args));
  const onHeading = useStableEvent((id: string) => props.onHeading?.(id));
  return <PassageBoundary {...props} text={shown.identity === identity ? shown.text : props.text} onReference={props.onReference || props.onPassageReference ? onReference : undefined} onHeading={props.onHeading ? onHeading : undefined} />;
});

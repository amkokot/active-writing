import { Component } from "react";
import { ReplyMarkdown, type ReplyMarkdownProps } from "../replyMarkdown";
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

export default function RenderedPassage(props: ReplyMarkdownProps) {
  return <PassageBoundary {...props} />;
}

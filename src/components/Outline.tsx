import {
  ChevronRight,
  ChevronDown,
  Circle,
  CircleCheck,
  CircleDot,
  Eye,
  EyeOff,
  MoreHorizontal,
  Scan,
} from "lucide-react";
import type {
  Lens,
  ManuscriptNode,
  ProgressState,
  RewriteSession,
  ThemeLens,
} from "../types";
import { outlineRows } from "../workspaceTools";
import { sectionHeadingLevel } from "../headingHierarchy";
import { memo } from "react";
import type { CSSProperties } from "react";

interface OutlineProps {
  onPreamble?:()=>void;
  lens: Lens;
  nodes: ManuscriptNode[];
  activeNodeId: string;
  focusedNodeId?: string;
  hiddenNodeIds: string[];
  collapsedNodeIds: string[];
  onToggleCollapsed: (nodeId: string) => void;
  onFold: () => void;
  progressByNode: Record<string, ProgressState>;
  rewriteSessions: RewriteSession[];
  themes: ThemeLens[];
  activeThemeId: string;
  onSelectNode: (nodeId: string) => void;
  onFocusNode: (nodeId?: string) => void;
  onToggleHidden: (nodeId: string) => void;
  onCycleProgress: (nodeId: string) => void;
  onSelectTheme: (themeId: string) => void;
}

function ProgressIcon({ state }: { state: ProgressState }) {
  if (state === "done") return <CircleCheck size={16} />;
  if (state === "progress") return <CircleDot size={16} />;
  return <Circle size={16} />;
}

function OutlineView({
  onPreamble,
  lens,
  nodes,
  activeNodeId,
  focusedNodeId,
  hiddenNodeIds,
  collapsedNodeIds,
  onToggleCollapsed,
  onFold,
  progressByNode,
  rewriteSessions,
  themes,
  activeThemeId,
  onSelectNode,
  onFocusNode,
  onToggleHidden,
  onCycleProgress,
  onSelectTheme,
}: OutlineProps) {
  if (lens === "themes") {
    return (
      <div className="outline-body">
        <div className="outline-caption">
          <span>Saved themes</span>
          <span>{themes.length}</span>
        </div>
        {themes.map((theme, index) => {
          const visibleCount = theme.matches.filter((match) => !match.excluded).length;
          return (
            <button
              className={`theme-row ${theme.id === activeThemeId ? "is-active" : ""}`}
              key={theme.id}
              aria-label={theme.name}
              title={theme.name}
              onClick={() => onSelectTheme(theme.id)}
            >
              <span className="theme-dot" />
              <span className="outline-full-label">{theme.name}</span>
              <span className="outline-rail-label" aria-hidden="true">{index + 1}</span>
              <small>{visibleCount} passages</small>
              <MoreHorizontal size={15} />
            </button>
          );
        })}
        <div className="outline-add">Select text to save another theme</div>
      </div>
    );
  }

  const displayedNodes = outlineRows(nodes, lens, collapsedNodeIds);
  const visibleIds = new Set(displayedNodes.map(({ node }) => node.id));
  const visited = new Set<string>();
  let railCurrent = nodes.find(node => node.id === activeNodeId);
  while (railCurrent && !visibleIds.has(railCurrent.id) && !visited.has(railCurrent.id)) {
    visited.add(railCurrent.id);
    railCurrent = nodes.find(node => node.id === railCurrent?.parentId);
  }

  return (
    <div className="outline-body">
      <div className="outline-caption">
        <span>{lens === "proofs" ? "Results & proofs" : "Contents"}</span>
        <button className="text-button" aria-label="Collapse contents branches" onClick={onFold}>Fold</button>
        <button className="text-button" onClick={() => onFocusNode(undefined)}>
          Clear focus
        </button>
      </div>
      {onPreamble && <button className="outline-preamble" aria-label="Edit preamble" title="Preamble · document settings and theorem declarations" onClick={onPreamble}><span className="outline-full-label">Preamble</span><span className="outline-rail-label" aria-hidden="true">P</span></button>}
      {displayedNodes.map(({ node, depth, expandable }, index) => {
        const hidden = hiddenNodeIds.includes(node.id);
        const current = node.id === activeNodeId;
        const focused = node.id === focusedNodeId;
        const draftCount = rewriteSessions.filter(
          (session) => session.nodeId === node.id && session.status === "draft",
        ).length;
        const label = `${node.number ? `${node.number} ` : ""}${node.title}`;
        return (
          <div
            className={`outline-row ${current ? "is-current" : ""} ${node.id === railCurrent?.id ? "is-rail-current" : ""} ${focused ? "is-focused" : ""} ${hidden ? "is-hidden" : ""}`}
            style={{ paddingLeft: `${8 + depth * 12}px`, "--outline-depth": depth } as CSSProperties}
            data-heading-level={sectionHeadingLevel(node)}
            key={node.id}
          >
            {expandable ? <button className="outline-disclosure" aria-label={`${collapsedNodeIds.includes(node.id) ? "Expand" : "Collapse"} ${label}`} aria-expanded={!collapsedNodeIds.includes(node.id)} onClick={() => onToggleCollapsed(node.id)}>
              {collapsedNodeIds.includes(node.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            </button> : <span className="outline-disclosure-spacer" />}
            <button className="outline-label" aria-label={label} aria-current={current ? "location" : undefined} onClick={() => onSelectNode(node.id)} title={label}>
              <span className="outline-full-label">{label}</span>
              <span className="outline-rail-label" aria-hidden="true">{node.number ?? index + 1}</span>
              {draftCount > 0 && <small>{draftCount} draft{draftCount > 1 ? "s" : ""}</small>}
            </button>
            <button
              className={`status-control is-${progressByNode[node.id] ?? "blank"}`}
              aria-label={`Progress for ${label}: ${progressByNode[node.id] ?? "blank"}`}
              title={(progressByNode[node.id] ?? "blank") === "progress" ? "Mark done; remove its section reminder (comments stay open)" : (progressByNode[node.id] ?? "blank") === "done" ? "Mark unfinished; add a section reminder" : "Mark in progress; add a section reminder"}
              onClick={() => onCycleProgress(node.id)}
            >
              <ProgressIcon state={progressByNode[node.id] ?? "blank"} />
            </button>
            <button
              className="icon-control"
              aria-label={`${hidden ? "Show" : "Hide"} ${label}`}
              onClick={() => onToggleHidden(node.id)}
            >
              {hidden ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
            <button
              className={`icon-control ${focused ? "is-on" : ""}`}
              aria-label={`${focused ? "Clear focus from" : "Focus on"} ${label}`}
              onClick={() => onFocusNode(focused ? undefined : node.id)}
            >
              <Scan size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export const Outline = memo(OutlineView);

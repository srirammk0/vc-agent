"use client";

import { useState, type ComponentType } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BarChart3,
  Building2,
  CircleCheckBig,
  CircleX,
  ExternalLink,
  Globe,
  Info,
  ListChecks,
  Sparkles,
  Table2,
  TriangleAlert,
  ChevronDown,
} from "lucide-react";
import StatusBadge from "../StatusBadge";

export type UiBlock =
  | { kind: "startup"; data: Record<string, unknown> }
  | { kind: "iframe"; data: Record<string, unknown> }
  | { kind: "metrics"; data: Record<string, unknown> }
  | { kind: "list"; data: Record<string, unknown> }
  | { kind: "actions"; data: Record<string, unknown> }
  | { kind: "status"; data: Record<string, unknown> }
  | { kind: "table"; data: Record<string, unknown> }
  | { kind: "link"; data: Record<string, unknown> };

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "ui"; block: UiBlock };

const UI_BLOCK_RE = /```ui:([a-z0-9-]+)\n([\s\S]*?)```/g;
// Matches an opening ui-block fence with no closing ``` yet — i.e. the model is
// still mid-stream on this block. We hide everything from here on so the raw
// ```ui:kind / JSON never flashes on screen; it resolves into a real card the
// moment the closing fence lands and this text gets reparsed on the next render.
const OPEN_UI_FENCE_RE = /```ui:[a-z0-9-]+\n/;

const KNOWN_KINDS = new Set([
  "startup",
  "iframe",
  "metrics",
  "list",
  "actions",
  "status",
  "table",
  "link",
]);

export function parseMessageParts(content: string): MessagePart[] {
  UI_BLOCK_RE.lastIndex = 0;
  const parts: MessagePart[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = UI_BLOCK_RE.exec(content)) !== null) {
    const before = content.slice(last, match.index).trim();
    if (before) parts.push({ type: "text", text: before });

    const blockType = match[1];
    try {
      const data = JSON.parse(match[2]);
      if (KNOWN_KINDS.has(blockType)) {
        parts.push({ type: "ui", block: { kind: blockType as UiBlock["kind"], data } });
      }
    } catch {
      // skip malformed blocks
    }
    last = match.index + match[0].length;
  }

  const tail = content.slice(last);
  const openFence = tail.match(OPEN_UI_FENCE_RE);
  const visibleTail = (openFence ? tail.slice(0, openFence.index) : tail).trim();
  if (visibleTail) parts.push({ type: "text", text: visibleTail });
  return parts;
}

function toHref(url: string): string {
  return url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function asNumber(v: unknown, fallback?: number): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asBool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function Kicker({
  icon: Icon,
  children,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  children: React.ReactNode;
}) {
  return (
    <div className="gen-card-kicker gen-card-kicker-icon">
      <Icon size={12} strokeWidth={2.25} />
      <span>{children}</span>
    </div>
  );
}

function Prose({ text }: { text: string }) {
  return (
    <div className="gen-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => (
            <a href={href} target="_blank" rel="noreferrer" {...props}>
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function StartupCard({ data }: { data: Record<string, unknown> }) {
  const name = asString(data.name) ?? "Untitled";
  const oneLiner = asString(data.one_liner);
  const status = asString(data.status);
  const website = asString(data.website);
  const assessment = asString(data.assessment);
  const [showIframe, setShowIframe] = useState(false);
  const badgeStatus =
    status === "new" || status === "approved" || status === "passed" ? status : undefined;

  return (
    <div className="gen-card gen-startup animate-scale-in">
      <div className="gen-startup-top">
        <div className="gen-startup-heading">
          <span className="gen-startup-icon">
            <Building2 size={14} strokeWidth={2.25} />
          </span>
          <div>
            <div className="gen-card-title">{name}</div>
            {oneLiner && <p className="gen-card-body">{oneLiner}</p>}
          </div>
        </div>
        {badgeStatus ? (
          <StatusBadge status={badgeStatus} />
        ) : status ? (
          <span className="gen-chip">{status}</span>
        ) : null}
      </div>
      {assessment && <p className="gen-card-note">{assessment}</p>}
      
      {website && (
        <div className="gen-startup-actions" style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", marginTop: "8px" }}>
          <a className="gen-link" href={toHref(website)} target="_blank" rel="noreferrer" style={{ marginTop: 0 }}>
            <ExternalLink size={11} strokeWidth={2.25} />
            {website.replace(/^https?:\/\//, "")}
          </a>
          <button
            type="button"
            className="gen-iframe-toggle"
            onClick={() => setShowIframe(!showIframe)}
          >
            <span>{showIframe ? "Hide preview" : "Preview website"}</span>
            <ChevronDown size={12} className={`gen-iframe-chevron${showIframe ? " gen-iframe-chevron-open" : ""}`} />
          </button>
        </div>
      )}
      
      {website && showIframe && (
        <div className="gen-iframe" style={{ height: 320, marginTop: 12 }}>
          <iframe
            src={toHref(website)}
            title={name}
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
      )}
    </div>
  );
}

function IframeCard({ data }: { data: Record<string, unknown> }) {
  const url = asString(data.url);
  const title = asString(data.title) ?? url ?? "Preview";
  const height = asNumber(data.height, 320) ?? 320;
  if (!url) return null;

  return (
    <div className="gen-card animate-scale-in">
      <Kicker icon={Globe}>{title}</Kicker>
      <div className="gen-iframe" style={{ height }}>
        <iframe
          src={toHref(url)}
          title={title}
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        />
      </div>
    </div>
  );
}

function MetricsCard({ data }: { data: Record<string, unknown> }) {
  const title = asString(data.title);
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length === 0) return null;

  return (
    <div className="gen-card animate-scale-in">
      {title && <Kicker icon={BarChart3}>{title}</Kicker>}
      <div className="gen-metrics">
        {items.map((item, i) => {
          if (!item || typeof item !== "object") return null;
          const row = item as Record<string, unknown>;
          const label = asString(row.label) ?? "—";
          const value = asString(row.value) ?? String(row.value ?? "—");
          const hint = asString(row.hint);
          return (
            <div key={i} className="gen-metric">
              <div className="gen-metric-value">{value}</div>
              <div className="gen-metric-label">{label}</div>
              {hint && <div className="gen-metric-hint">{hint}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListCard({ data }: { data: Record<string, unknown> }) {
  const title = asString(data.title);
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length === 0) return null;

  return (
    <div className="gen-card animate-scale-in">
      {title && <Kicker icon={ListChecks}>{title}</Kicker>}
      <ul className="gen-list">
        {items.map((item, i) => {
          if (typeof item === "string") {
            return (
              <li key={i} className="gen-list-item">
                <span className="gen-list-title">{item}</span>
              </li>
            );
          }
          if (!item || typeof item !== "object") return null;
          const row = item as Record<string, unknown>;
          const label = asString(row.title) ?? asString(row.name) ?? asString(row.label) ?? "—";
          const subtitle = asString(row.subtitle) ?? asString(row.one_liner) ?? asString(row.detail);
          const meta = asString(row.meta) ?? asString(row.status);
          return (
            <li key={i} className="gen-list-item">
              <div className="gen-list-row">
                <div>
                  <div className="gen-list-title">{label}</div>
                  {subtitle && <div className="gen-list-sub">{subtitle}</div>}
                </div>
                {meta && <span className="gen-chip">{meta}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ActionsCard({
  data,
  onAction,
}: {
  data: Record<string, unknown>;
  onAction?: (prompt: string) => void;
}) {
  const title = asString(data.title);
  const items = Array.isArray(data.actions) ? data.actions : Array.isArray(data.items) ? data.items : [];
  if (items.length === 0) return null;

  return (
    <div className="gen-actions-wrap animate-scale-in">
      {title && (
        <div className="gen-card-kicker gen-card-kicker-icon" style={{ marginBottom: 8 }}>
          <Sparkles size={12} strokeWidth={2.25} />
          <span>{title}</span>
        </div>
      )}
      <div className="gen-actions">
        {items.map((item, i) => {
          if (!item || typeof item !== "object") return null;
          const row = item as Record<string, unknown>;
          const label = asString(row.label) ?? asString(row.title);
          const prompt = asString(row.prompt) ?? label;
          if (!label || !prompt) return null;
          return (
            <button
              key={i}
              type="button"
              className="gen-action"
              onClick={() => onAction?.(prompt)}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const STATUS_ICONS: Record<string, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  info: Info,
  success: CircleCheckBig,
  warning: TriangleAlert,
  danger: CircleX,
};

function StatusCard({ data }: { data: Record<string, unknown> }) {
  const tone = asString(data.tone) ?? "info";
  const title = asString(data.title);
  const body = asString(data.body) ?? asString(data.message);
  if (!title && !body) return null;
  const Icon = STATUS_ICONS[tone] ?? Info;

  return (
    <div className={`gen-status gen-status-${tone} animate-scale-in`}>
      <span className="gen-status-icon">
        <Icon size={15} strokeWidth={2.25} />
      </span>
      <div>
        {title && <div className="gen-status-title">{title}</div>}
        {body && <div className="gen-status-body">{body}</div>}
      </div>
    </div>
  );
}

function TableCard({ data }: { data: Record<string, unknown> }) {
  const title = asString(data.title);
  const columns = Array.isArray(data.columns)
    ? data.columns.filter((c): c is string => typeof c === "string")
    : [];
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (columns.length === 0 || rows.length === 0) return null;

  return (
    <div className="gen-card animate-scale-in" style={{ overflow: "hidden", padding: 0 }}>
      {title && (
        <div className="gen-card-kicker gen-card-kicker-icon" style={{ padding: "12px 14px 0" }}>
          <Table2 size={12} strokeWidth={2.25} />
          <span>{title}</span>
        </div>
      )}
      <div className="gen-table-scroll">
        <table className="gen-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const cells = Array.isArray(row) ? row : [];
              return (
                <tr key={i}>
                  {columns.map((_, j) => (
                    <td key={j}>{cells[j] == null ? "—" : String(cells[j])}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LinkCard({ data }: { data: Record<string, unknown> }) {
  const url = asString(data.url);
  const title = asString(data.title) ?? url;
  const description = asString(data.description) ?? asString(data.subtitle);
  const showEmbed = data.embed !== false && Boolean(url);
  if (!url || !title) return null;

  return (
    <div className="gen-stack animate-scale-in">
      <a className="gen-link-card" href={toHref(url)} target="_blank" rel="noreferrer">
        <div className="gen-link-card-top">
          <div className="gen-link-card-title">{title}</div>
          <ExternalLink size={13} strokeWidth={2.25} className="gen-link-card-arrow" />
        </div>
        {description && <div className="gen-link-card-desc">{description}</div>}
        <div className="gen-link-card-url">{url.replace(/^https?:\/\//, "")}</div>
      </a>
      {showEmbed && (
        <div className="gen-iframe" style={{ height: 280 }}>
          <iframe
            src={toHref(url)}
            title={title}
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
      )}
    </div>
  );
}

export function GenerativeBlock({
  block,
  onAction,
}: {
  block: UiBlock;
  onAction?: (prompt: string) => void;
}) {
  switch (block.kind) {
    case "startup":
      return <StartupCard data={block.data} />;
    case "iframe":
      return <IframeCard data={block.data} />;
    case "metrics":
      return <MetricsCard data={block.data} />;
    case "list":
      return <ListCard data={block.data} />;
    case "actions":
      return <ActionsCard data={block.data} onAction={onAction} />;
    case "status":
      return <StatusCard data={block.data} />;
    case "table":
      return <TableCard data={block.data} />;
    case "link":
      return <LinkCard data={block.data} />;
    default:
      return null;
  }
}

export function MessageContent({
  content,
  onAction,
}: {
  content: string;
  onAction?: (prompt: string) => void;
}) {
  const parts = parseMessageParts(content);
  if (parts.length === 0) return null;

  return (
    <div className="gen-stack">
      {parts.map((part, i) =>
        part.type === "text" ? (
          <Prose key={i} text={part.text} />
        ) : (
          <GenerativeBlock key={i} block={part.block} onAction={onAction} />
        )
      )}
    </div>
  );
}

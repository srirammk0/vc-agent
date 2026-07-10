"use client";

import { memo } from "react";
import { MessageContent } from "./generative";
import ToolTrace from "./ToolTrace";
import type { ToolTraceEntry } from "../../../lib/chatTypes";

type Props = {
  role: "user" | "assistant";
  content: string;
  trace?: ToolTraceEntry[];
  onAction?: (prompt: string) => void;
};

function ChatMessageRow({ role, content, trace, onAction }: Props) {
  if (role === "user") {
    return (
      <div className="chat-turn chat-turn-user">
        <div className="chat-user-msg">{content}</div>
      </div>
    );
  }
  return (
    <div className="chat-turn chat-turn-assistant">
      <ToolTrace trace={trace} />
      <MessageContent content={content} onAction={onAction} />
    </div>
  );
}

export default memo(ChatMessageRow);

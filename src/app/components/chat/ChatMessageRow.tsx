"use client";

import { memo } from "react";
import { MessageContent } from "./generative";

type Props = {
  role: "user" | "assistant";
  content: string;
  onAction?: (prompt: string) => void;
};

function ChatMessageRow({ role, content, onAction }: Props) {
  if (role === "user") {
    return (
      <div className="chat-turn chat-turn-user">
        <div className="chat-user-msg">{content}</div>
      </div>
    );
  }
  return (
    <div className="chat-turn chat-turn-assistant">
      <MessageContent content={content} onAction={onAction} />
    </div>
  );
}

export default memo(ChatMessageRow);

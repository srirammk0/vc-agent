// Shared web-chat streaming contract between the frontend and api/chat.py.
// Keep in sync with agent/agent.py's run_web_chat_stream event dicts.

export type ToolTraceEntry = {
  id: string;
  toolName: string;
  args: unknown;
  result?: string;
  status: "running" | "done";
};

export type ChatSSEEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; tool_call_id: string; tool_name: string; args: unknown }
  | { type: "tool_result"; tool_call_id: string; result: string }
  | { type: "done" }
  | { type: "error"; message: string; retryable: boolean };

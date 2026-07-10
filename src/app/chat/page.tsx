import type { Metadata } from "next";
import AgentChat from "../components/AgentChat";

export const metadata: Metadata = {
  title: "Agent Chat — VC Scout",
};

export default function ChatPage() {
  return <AgentChat />;
}

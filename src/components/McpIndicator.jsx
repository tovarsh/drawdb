import { useState } from "react";
import { Input, Popover, Button } from "@douyinfe/semi-ui";
import { useMcp } from "../context/McpContext";

export default function McpIndicator() {
  const { status, sessionId, relayUrl, setRelayUrl } = useMcp();
  const [open, setOpen] = useState(false);
  const [editUrl, setEditUrl] = useState(relayUrl);

  const colors = {
    connected: "#10b981",
    connecting: "#f59e0b",
    disconnected: "#6b7280",
  };

  const labels = {
    connected: sessionId ? `AI connected (${sessionId})` : "AI connected",
    connecting: "AI connecting…",
    disconnected: "AI disconnected",
  };

  const handleSave = () => {
    const trimmed = editUrl.trim();
    if (trimmed && trimmed !== relayUrl) {
      setRelayUrl(trimmed);
    }
    setOpen(false);
  };

  const handleReset = () => {
    setEditUrl("ws://localhost:3001");
  };

  const content = (
    <div className="w-72 space-y-3">
      <div className="text-xs font-medium text-gray-500">
        Relay Server
      </div>
      <Input
        value={editUrl}
        onChange={setEditUrl}
        placeholder="ws://localhost:3001"
        size="small"
        onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
      />
      <div className="text-xs text-gray-400">
        {status === "connected"
          ? `Connected${sessionId ? ` (${sessionId})` : ""}`
          : status === "connecting"
            ? "Connecting…"
            : "Disconnected — relay not reachable"}
      </div>
      <div className="flex gap-2">
        <Button size="small" theme="solid" onClick={handleSave}>
          Save & Reconnect
        </Button>
        <Button size="small" onClick={handleReset}>
          Reset
        </Button>
      </div>
    </div>
  );

  return (
    <Popover
      content={content}
      position="bottomRight"
      visible={open}
      onVisibleChange={setOpen}
      showArrow
      trigger="click"
    >
      <div
        className="flex items-center gap-1.5 cursor-pointer select-none px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        title={labels[status]}
      >
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{
            backgroundColor: colors[status],
            boxShadow: status === "connected" ? `0 0 6px ${colors[status]}` : "none",
            transition: "all 0.3s ease",
          }}
        />
        <span className="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline">
          MCP
        </span>
      </div>
    </Popover>
  );
}

import { useState } from "react";
import { Input, Popover, Button } from "@douyinfe/semi-ui";
import { useMcp } from "../context/McpContext";

export default function McpIndicator() {
  const { status, sessionId, relayUrl, setRelayUrl, disabled, stop, reconnect } = useMcp();
  const [open, setOpen] = useState(false);
  const [editUrl, setEditUrl] = useState(relayUrl);

  const colors = {
    connected: "#10b981",
    connecting: "#f59e0b",
    disconnected: "#6b7280",
    disabled: "#d1d5db",
  };

  const currentStatus = disabled ? "disabled" : status;

  const labels = {
    connected: sessionId ? `AI connected (${sessionId})` : "AI connected",
    connecting: "AI connecting…",
    disconnected: "AI disconnected",
    disabled: "MCP off",
  };

  const handleSave = () => {
    const trimmed = editUrl.trim();
    if (trimmed && trimmed !== relayUrl) {
      setRelayUrl(trimmed);
    }
    setOpen(false);
  };

  const handleReset = () => {
    setEditUrl("");
    setRelayUrl("");
  };

  const content = (
    <div className="w-72 space-y-3">
      <div className="text-xs font-medium text-gray-500">
        Relay Server
      </div>
      <Input
        value={editUrl}
        onChange={setEditUrl}
        placeholder="ws://localhost:23432"
        size="small"
        onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
      />
      <div className="text-xs text-gray-400">
        {currentStatus === "connected"
          ? `Connected${sessionId ? ` (${sessionId})` : ""}`
          : currentStatus === "connecting"
            ? "Scanning ports 23432-23442…"
            : currentStatus === "disabled"
              ? "MCP connection stopped"
              : "Relay not reachable"}
      </div>
      <div className="text-xs text-gray-400">
        Connect AI assistants to edit diagrams.{" "}
        <a
          href="https://github.com/tovarsh/mcp-drawdb"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:underline"
        >
          Learn more →
        </a>
      </div>
      <div className="flex gap-2">
        {!disabled && (
          <>
            <Button size="small" theme="solid" onClick={handleSave}>
              Save
            </Button>
            <Button size="small" onClick={handleReset}>
              Reset
            </Button>
            <Button size="small" type="danger" onClick={() => { stop(); setOpen(false); }}>
              Stop
            </Button>
          </>
        )}
        {disabled && (
          <Button size="small" theme="solid" onClick={() => { reconnect(); setOpen(false); }}>
            Reconnect
          </Button>
        )}
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
        title={labels[currentStatus]}
      >
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{
            backgroundColor: colors[currentStatus],
            boxShadow: currentStatus === "connected" ? `0 0 6px ${colors.connected}` : "none",
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

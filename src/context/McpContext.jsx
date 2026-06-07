import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useDiagram, useSettings, useTypes, useEnums, useUndoRedo } from "../hooks";
import { toolHandlers, applyMutation } from "./McpHandlers";
import { Msg } from "./McpProtocol";

const McpContext = createContext(null);

const PORT_START = 23432;
const PORT_END = 23442;
const RELAY_URL_KEY = "mcp_relay_url";
const RECONNECT_DELAY = 3000;

/** Scan ports in parallel, return the first WebSocket that gets browser:registered. */
function scanPorts(ports, onRegistered) {
  let settled = false;
  const sockets = [];

  for (const port of ports) {
    let ws;
    try {
      ws = new WebSocket(`ws://localhost:${port}`);
    } catch {
      continue;
    }
    sockets.push(ws);

    const timer = setTimeout(() => {
      if (!settled) ws.close();
    }, 3000);

    ws.onopen = () => {
      if (settled) { ws.close(); return; }
      ws.send(JSON.stringify({ type: Msg.BROWSER_REGISTER }));
    };

    ws.onmessage = (event) => {
      if (settled) return;
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === Msg.BROWSER_REGISTERED) {
        settled = true;
        clearTimeout(timer);
        sockets.forEach((s) => { if (s !== ws && s.readyState < 2) s.close(); });
        onRegistered(ws, msg.sessionId, port);
      }
    };

    ws.onerror = () => {};
    ws.onclose = () => clearTimeout(timer);
  }

  // If ALL fail, report failure after timeout
  setTimeout(() => {
    if (!settled) {
      settled = true;
      sockets.forEach((s) => { if (s.readyState < 2) s.close(); });
      onRegistered(null);
    }
  }, 3500);
}

export default function McpContextProvider({ children }) {
  const diagram = useDiagram();
  const settings = useSettings();
  const { types } = useTypes();
  const { enums } = useEnums();
  const undoRedo = useUndoRedo();
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const [disabled, setDisabled] = useState(() => localStorage.getItem("mcp_disabled") === "true");
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const [status, setStatus] = useState("disconnected");
  const [sessionId, setSessionId] = useState(null);
  const [relayUrl, setRelayUrlState] = useState(
    () => localStorage.getItem(RELAY_URL_KEY) || "",
  );
  const diagramRef = useRef(diagram);
  diagramRef.current = diagram;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const typesRef = useRef(types);
  typesRef.current = types;
  const enumsRef = useRef(enums);
  enumsRef.current = enums;
  const undoRedoRef = useRef(undoRedo);
  undoRedoRef.current = undoRedo;

  // Ref to break circular dependency between wireSocket ↔ connect
  const connectFnRef = useRef(null);

  const setRelayUrl = useCallback((url) => {
    localStorage.setItem(RELAY_URL_KEY, url);
    setRelayUrlState(url);
  }, []);

  const disconnect = useCallback(() => {
    clearTimeout(reconnectTimer.current);
    reconnectTimer.current = null;
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("disconnected");
    setSessionId(null);
  }, []);

  const handleToolCall = useCallback((ws, msg) => {
    const { requestId, name, arguments: args } = msg;
    const handler = toolHandlers[name];

    if (!handler) {
      ws.send(JSON.stringify({
        type: Msg.BROWSER_TOOL_RESULT,
        requestId,
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      }));
      return;
    }

    try {
      const handlerContext = {
        ...diagramRef.current,
        ...settingsRef.current,
        types: typesRef.current,
        enums: enumsRef.current,
        undoStack: undoRedoRef.current?.undoStack,
        redoStack: undoRedoRef.current?.redoStack,
      };
      const result = handler(args, handlerContext, settingsRef.current);
      applyMutation(diagramRef, result._mutate);

      ws.send(JSON.stringify({
        type: Msg.BROWSER_TOOL_RESULT,
        requestId,
        content: result.content,
        isError: result.isError ?? false,
      }));
    } catch (err) {
      ws.send(JSON.stringify({
        type: Msg.BROWSER_TOOL_RESULT,
        requestId,
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      }));
    }
  }, []);

  const wireSocket = useCallback((ws, sid, port) => {
    const url = `ws://localhost:${port}`;
    localStorage.setItem(RELAY_URL_KEY, url);
    setRelayUrlState(url);
    wsRef.current = ws;
    setStatus("connected");
    setSessionId(sid);

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === Msg.BROWSER_TOOL_CALL) {
        handleToolCall(ws, msg);
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      setStatus("disconnected");
      setSessionId(null);
      if (!disabledRef.current) {
        reconnectTimer.current = setTimeout(() => connectFnRef.current?.(), RECONNECT_DELAY);
      }
    };
  }, [handleToolCall]);

  const connect = useCallback(() => {
    if (disabledRef.current) return;
    disconnect();
    setStatus("connecting");

    const stored = localStorage.getItem(RELAY_URL_KEY);
    const storedPort = stored ? parseInt(stored.replace(/.*:(\d+)\/?/, "$1"), 10) : 0;

    // Build port list: stored port first, then full range
    const ports = [];
    if (storedPort >= PORT_START && storedPort <= PORT_END) ports.push(storedPort);
    for (let p = PORT_START; p <= PORT_END; p++) {
      if (p !== storedPort) ports.push(p);
    }

    scanPorts(ports, (ws, sid, port) => {
      if (ws) {
        wireSocket(ws, sid, port);
      } else {
        setStatus("disconnected");
        reconnectTimer.current = setTimeout(() => connectFnRef.current?.(), RECONNECT_DELAY);
      }
    });
  }, [disconnect, wireSocket]);

  // Wire up the ref after both functions are defined
  connectFnRef.current = connect;

  const stop = useCallback(() => {
    disconnect();
    setDisabled(true);
    localStorage.setItem("mcp_disabled", "true");
  }, [disconnect]);

  const reconnect = useCallback(() => {
    setDisabled(false);
    disabledRef.current = false;
    localStorage.removeItem("mcp_disabled");
    connect();
  }, [connect]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  const value = useMemo(() => ({
    status,
    sessionId,
    isConnected: status === "connected",
    relayUrl,
    setRelayUrl,
    disabled,
    stop,
    reconnect,
  }), [status, sessionId, relayUrl, setRelayUrl, disabled, stop, reconnect]);

  return (
    <McpContext.Provider value={value}>
      {children}
    </McpContext.Provider>
  );
}

export function useMcp() {
  return useContext(McpContext);
}

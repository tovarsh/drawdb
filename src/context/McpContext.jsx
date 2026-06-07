import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useDiagram, useSettings, useTypes, useEnums, useUndoRedo } from "../hooks";
import { toolHandlers, applyMutation } from "./McpHandlers";
import { Msg } from "./McpProtocol";

const McpContext = createContext(null);

const DEFAULT_RELAY_URL = "ws://localhost:3001";
const RELAY_URL_KEY = "mcp_relay_url";
const RECONNECT_DELAY = 3000;

export default function McpContextProvider({ children }) {
  const diagram = useDiagram();
  const settings = useSettings();
  const { types } = useTypes();
  const { enums } = useEnums();
  const undoRedo = useUndoRedo();
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const [status, setStatus] = useState("disconnected");
  const [sessionId, setSessionId] = useState(null);
  const [relayUrl, setRelayUrlState] = useState(
    () => localStorage.getItem(RELAY_URL_KEY) || DEFAULT_RELAY_URL,
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

  const setRelayUrl = useCallback((url) => {
    localStorage.setItem(RELAY_URL_KEY, url);
    setRelayUrlState(url);
  }, []);

  const disconnect = useCallback(() => {
    clearTimeout(reconnectTimer.current);
    reconnectTimer.current = null;
    if (wsRef.current) {
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

  const connect = useCallback(() => {
    disconnect();

    setStatus("connecting");
    try {
      const ws = new WebSocket(relayUrl);

      ws.onopen = () => {
        wsRef.current = ws;
        setStatus("connected");
        ws.send(JSON.stringify({ type: Msg.BROWSER_REGISTER }));
      };

      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type === Msg.BROWSER_REGISTERED) {
          setSessionId(msg.sessionId);
          return;
        }

        if (msg.type === Msg.BROWSER_TOOL_CALL) {
          handleToolCall(ws, msg);
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        setStatus("disconnected");
        setSessionId(null);
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
      };

      ws.onerror = () => {};
    } catch {
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
    }
  }, [relayUrl, disconnect, handleToolCall]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const value = useMemo(() => ({
    status,
    sessionId,
    isConnected: status === "connected",
    relayUrl,
    setRelayUrl,
    reconnect: connect,
  }), [status, sessionId, relayUrl, setRelayUrl, connect]);

  return (
    <McpContext.Provider value={value}>
      {children}
    </McpContext.Provider>
  );
}

export function useMcp() {
  return useContext(McpContext);
}

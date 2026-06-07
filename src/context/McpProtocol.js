/**
 * Shared protocol message type constants.
 * Must stay in sync with mcp-drawdb/src/types.ts Msg object.
 */
export const Msg = {
  // Browser → Relay
  BROWSER_REGISTER: "browser:register",
  BROWSER_TOOL_RESULT: "browser:tool_result",
  BROWSER_PONG: "browser:pong",

  // npx → Relay
  CLIENT_CONNECT: "client:connect",
  CLIENT_TOOL_CALL: "client:tool_call",
  CLIENT_PING: "client:ping",

  // Relay → Browser
  BROWSER_REGISTERED: "browser:registered",
  BROWSER_TOOL_CALL: "browser:tool_call",

  // Relay → npx
  CLIENT_CONNECTED: "client:connected",
  CLIENT_TOOL_RESULT: "client:tool_result",
  CLIENT_ERROR: "client:error",
};

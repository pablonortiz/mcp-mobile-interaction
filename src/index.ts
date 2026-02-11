#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerListDevicesTool } from "./tools/list-devices.js";
import { registerScreenshotTool } from "./tools/screenshot.js";
import { registerTapTool } from "./tools/tap.js";
import { registerDoubleTapTool } from "./tools/double-tap.js";
import { registerLongPressTool } from "./tools/long-press.js";
import { registerSwipeTool } from "./tools/swipe.js";
import { registerTypeTextTool } from "./tools/type-text.js";
import { registerPressKeyTool } from "./tools/press-key.js";
import { registerGetUiTreeTool } from "./tools/get-ui-tree.js";
import { registerGetScreenInfoTool } from "./tools/get-screen-info.js";
import { registerLaunchAppTool } from "./tools/launch-app.js";
import { registerOpenUrlTool } from "./tools/open-url.js";
import { registerWaitForElementTool } from "./tools/wait-for-element.js";
import { registerWaitForStableTool } from "./tools/wait-for-stable.js";
import { registerTapElementTool } from "./tools/tap-element.js";
import { registerGetScreenStateTool } from "./tools/get-screen-state.js";

const server = new McpServer({
  name: "mcp-mobile-interaction",
  version: "1.0.0",
});

// Register all 16 tools
registerListDevicesTool(server);
registerScreenshotTool(server);
registerTapTool(server);
registerDoubleTapTool(server);
registerLongPressTool(server);
registerSwipeTool(server);
registerTypeTextTool(server);
registerPressKeyTool(server);
registerGetUiTreeTool(server);
registerGetScreenInfoTool(server);
registerLaunchAppTool(server);
registerOpenUrlTool(server);
registerWaitForElementTool(server);
registerWaitForStableTool(server);
registerTapElementTool(server);
registerGetScreenStateTool(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-mobile-interaction server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

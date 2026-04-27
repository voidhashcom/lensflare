/**
 * Shared install instructions for MCP clients (Claude Code, Cursor, Codex,
 * VS Code/Copilot, Windsurf, OpenCode, Antigravity).
 *
 * Single source of truth for both:
 *   • the public docs page at `apps/marketing/src/pages/docs/mcp.astro`
 *   • the in-app MCP tab at
 *     `apps/web/src/components/LogStream/EmptyDatasetGuide/McpTab.tsx`
 *
 * The MCP URL is parameterised via {@link buildMcpClientGuides} so the
 * marketing site can render with the canonical default URL while the
 * in-app tab can render with the live URL from the bootstrap descriptor
 * (`LensflareEnvironmentDescriptor.mcpUrl`).
 *
 * The host/port constants below mirror `browser.ts`
 * (`DEFAULT_HOST`, `DEFAULT_SERVER_PORT`).
 *
 * Pure TypeScript — no React/Astro/Effect imports — so any consumer can
 * safely depend on this module.
 */

/** Mirrors `DEFAULT_HOST` in `browser.ts`. */
export const DEFAULT_MCP_HOST = "127.0.0.1";

/** Mirrors `DEFAULT_SERVER_PORT` in `browser.ts`. */
export const DEFAULT_MCP_PORT = 43110;

/** Canonical MCP URL the desktop app exposes when started with defaults. */
export const DEFAULT_MCP_URL = `http://${DEFAULT_MCP_HOST}:${DEFAULT_MCP_PORT}/mcp`;

/** GitHub repo that hosts the plugin marketplace manifests. */
export const PLUGIN_MARKETPLACE_REPO = "voidhashcom/lensflare";

/** Public-facing GitHub URL for the marketplace repo. */
export const PLUGIN_MARKETPLACE_URL = `https://github.com/${PLUGIN_MARKETPLACE_REPO}`;

export type McpClientId =
  | "claude-code"
  | "cursor"
  | "codex"
  | "vscode"
  | "windsurf"
  | "opencode"
  | "antigravity";

export type McpClientInstallMethod = "marketplace" | "manual";

export interface McpGuideSnippet {
  /** `shell` for terminal commands; `json` for config-file payloads. */
  readonly kind: "shell" | "json";
  /**
   * Optional file the snippet should be written to. Rendered as a header
   * above the code block in both surfaces.
   */
  readonly filename?: string;
  readonly code: string;
}

export interface McpGuideStep {
  readonly body?: string;
  readonly snippet?: McpGuideSnippet;
}

export interface McpClientGuide {
  readonly id: McpClientId;
  readonly label: string;
  /** One-line elevator pitch describing how this client connects. */
  readonly summary: string;
  readonly installMethod: McpClientInstallMethod;
  readonly steps: ReadonlyArray<McpGuideStep>;
  /** What the user can ask the assistant to confirm the connection works. */
  readonly verification: string;
  /** Optional link to the client's own MCP documentation. */
  readonly docsUrl?: string;
}

/**
 * Build the per-client install guides bound to a specific MCP URL. Pass the
 * live `mcpUrl` from the environment descriptor when rendering in-app, or
 * {@link DEFAULT_MCP_URL} when rendering at build time on the marketing
 * site.
 */
export function buildMcpClientGuides(mcpUrl: string): ReadonlyArray<McpClientGuide> {
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      summary: "Install via the Claude Code plugin marketplace.",
      installMethod: "marketplace",
      steps: [
        {
          body: "Add the Lensflare marketplace.",
          snippet: {
            kind: "shell",
            code: `/plugin marketplace add ${PLUGIN_MARKETPLACE_REPO}`,
          },
        },
        {
          body: "Install the desktop plugin.",
          snippet: {
            kind: "shell",
            code: "/plugin install lensflare-desktop@lensflare",
          },
        },
      ],
      verification:
        'Ask Claude Code: "What datasets do I have in Lensflare?" — it should call lensflare:listDatasets.',
      docsUrl: "https://code.claude.com/docs/en/discover-plugins",
    },
    {
      id: "cursor",
      label: "Cursor",
      summary: "Add a server entry to .cursor/mcp.json (project) or your Cursor config (global).",
      installMethod: "manual",
      steps: [
        {
          body: "Create or edit .cursor/mcp.json at the root of your project (or your global Cursor config).",
          snippet: {
            kind: "json",
            filename: ".cursor/mcp.json",
            code: JSON.stringify(
              { mcpServers: { lensflare: { type: "http", url: mcpUrl } } },
              null,
              2,
            ),
          },
        },
        {
          body: "Reload Cursor (Cmd/Ctrl-Shift-P → Cursor: Reload) so the new server is picked up.",
        },
      ],
      verification: 'In Cursor agent mode, ask: "What datasets do I have in Lensflare?"',
      docsUrl: "https://docs.cursor.com/context/model-context-protocol",
    },
    {
      id: "codex",
      label: "Codex",
      summary: "Add Lensflare in Codex Settings → MCP Servers (Streamable HTTP).",
      installMethod: "manual",
      steps: [
        {
          body: "Open Codex Settings → MCP Servers → Add custom server. Switch to the Streamable HTTP tab.",
        },
        {
          body: `Set Name to "lensflare" and URL to ${mcpUrl}. Save.`,
        },
      ],
      verification:
        'Ask Codex: "What datasets do I have in Lensflare?" — Codex should list the lensflare server in its tool list.',
    },
    {
      id: "vscode",
      label: "VS Code / GitHub Copilot",
      summary: "Drop a .vscode/mcp.json into the workspace.",
      installMethod: "manual",
      steps: [
        {
          body: "Create .vscode/mcp.json in your workspace.",
          snippet: {
            kind: "json",
            filename: ".vscode/mcp.json",
            code: JSON.stringify(
              { servers: { lensflare: { type: "http", url: mcpUrl } } },
              null,
              2,
            ),
          },
        },
        {
          body: "Restart VS Code so Copilot Chat picks up the new server.",
        },
      ],
      verification: 'In Copilot Chat, ask: "What datasets do I have in Lensflare?"',
      docsUrl: "https://code.visualstudio.com/docs/copilot/customization/mcp-servers",
    },
    {
      id: "windsurf",
      label: "Windsurf",
      summary: "Add Lensflare in Windsurf Settings → Cascade → MCP Servers.",
      installMethod: "manual",
      steps: [
        {
          body: "Open Windsurf Settings → Cascade → MCP Servers → Add server, or edit ~/.codeium/windsurf/mcp_config.json directly.",
          snippet: {
            kind: "json",
            filename: "~/.codeium/windsurf/mcp_config.json",
            code: JSON.stringify({ mcpServers: { lensflare: { serverUrl: mcpUrl } } }, null, 2),
          },
        },
      ],
      verification: 'In Cascade, ask: "What datasets do I have in Lensflare?"',
    },
    {
      id: "opencode",
      label: "OpenCode",
      summary: "Add Lensflare to opencode.json under the mcp key.",
      installMethod: "manual",
      steps: [
        {
          body: "Edit your opencode.json (project or ~/.config/opencode/opencode.json).",
          snippet: {
            kind: "json",
            filename: "opencode.json",
            code: JSON.stringify(
              {
                mcp: {
                  lensflare: { type: "remote", url: mcpUrl, enabled: true },
                },
              },
              null,
              2,
            ),
          },
        },
      ],
      verification: 'Ask OpenCode: "What datasets do I have in Lensflare?"',
      docsUrl: "https://opencode.ai/docs/mcp-servers",
    },
    {
      id: "antigravity",
      label: "Antigravity",
      summary: "Edit ~/.codeium/antigravity/mcp_config.json (or the workspace-level equivalent).",
      installMethod: "manual",
      steps: [
        {
          body: "Add the Lensflare server to mcp_config.json.",
          snippet: {
            kind: "json",
            filename: "~/.codeium/antigravity/mcp_config.json",
            code: JSON.stringify({ mcpServers: { lensflare: { serverUrl: mcpUrl } } }, null, 2),
          },
        },
      ],
      verification: 'Ask the agent: "What datasets do I have in Lensflare?"',
    },
  ];
}

/**
 * Pre-built guide list bound to {@link DEFAULT_MCP_URL}. Convenient for
 * static rendering on the marketing site; in-app surfaces should call
 * {@link buildMcpClientGuides} with the live descriptor URL instead.
 */
export const DEFAULT_MCP_CLIENT_GUIDES: ReadonlyArray<McpClientGuide> =
  buildMcpClientGuides(DEFAULT_MCP_URL);

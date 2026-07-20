# Claude Desktop local-repository bundle

This machine-specific development bundle makes Claude launch UniFact with the system Node.js executable and import the MCP server from the local checkout. It avoids loading the standalone-Node `better-sqlite3` binary inside Electron.

Before packaging or launching, run `npm run build` in the UniFact repository. Build the extension with `npm run build:claude-linked`.

The manifest embeds this machine's verified Node.js, repository, and database paths, so Claude does not show a configuration form. Rebuild the bundle if those paths move.

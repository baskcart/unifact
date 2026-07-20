# Claude Desktop bundle

Run `npm run build:claude-desktop` from the repository root. The Windows development bundle is written to `release/` and can be installed from Claude Desktop under **Settings → Extensions → Advanced settings → Install Extension**.

The bundle uses Claude Desktop's built-in Node.js runtime. During setup, choose an existing UniFact SQLite database to share its facts, or keep `~/.unifact/store.db` for a separate Claude store. On this development machine the existing database is `C:\Users\admin\git\unifact\store.db`.

Production directory submission still requires approved branding, privacy/support metadata, signing credentials, and marketplace review.

# maermin-mcp

A local, read-only [MCP](https://modelcontextprotocol.io) server over your MAERMIN portfolio. It lets an AI assistant on your computer, such as Claude Desktop or Claude Code, answer questions about your positions, transactions, returns, dividends and taxes.

- **Everything runs on your machine.** It decrypts your encrypted vault backup in memory with your password, using the app's own `crypto-vault.js`. No server ever sees your data in plaintext.
- **No network.** The only exception is `--sync`, which reads your newest data from **your own** Worker, and only as ciphertext.
- **Read-only.** It can't change anything in MAERMIN.
- **Credentials are dropped** before any tool runs: API keys, bank, exchange and wallet connections, the push subscription, and your taxpayer name and tax ID.
- **Amounts are hidden by default.** Tools answer in percentages until you start the server with `--amounts`.

## 1. Export an encrypted backup

In MAERMIN: open the settings menu (gear icon) and choose **Backup vault (encrypted)**. Save the `.json` file somewhere only you can read, for example `~/maermin/vault-backup.json`. Export it again whenever you want newer data, or use `--sync`.

## 2. Install

```bash
npm install -g maermin-mcp
```

Node 18 or later. No dependencies. From a checkout of the repository you can also run `node mcp/bin/maermin-mcp.js`.

## 3. Add it to your assistant

The vault password is never passed on the command line, because other processes could read it there. Use the `MAERMIN_PASSWORD` environment variable of the MCP config, or `--password-file` pointing to a file only you can read.

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "maermin": {
      "command": "maermin-mcp",
      "args": ["--backup", "/Users/you/maermin/vault-backup.json", "--password-file", "/Users/you/maermin/.pw"]
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add maermin -- maermin-mcp --backup ~/maermin/vault-backup.json --password-file ~/maermin/.pw
```

Add `--amounts` to the arguments if the assistant may see quantities, prices and values.

## Options

| Option | |
|---|---|
| `--backup <file>` | the encrypted backup (required; or `MAERMIN_BACKUP`) |
| `--scopes <list>` | tools to offer, comma-separated; default: all |
| `--amounts` | include quantities, prices, values and tax figures in EUR |
| `--usd-eur <rate>` | EUR per USD; needed when the vault has amounts in USD or another currency, since the backup holds no exchange-rate history. There is no default rate: without it those tools refuse (`transactions` still works) |
| `--sync <worker-url>` | also read the newer sync blob from your own Worker (cloud sync must be on) |
| `--password-file <file>` | read the password from a file instead of `MAERMIN_PASSWORD` |

## Tools

All tools are read-only (`readOnlyHint`).

| Tool | Without `--amounts` | With `--amounts`, in addition |
|---|---|---|
| `overview` | portfolios, number of positions and transactions, allocation by asset class in %, date of the latest price | total value |
| `positions` | weight and unrealised return in %, holding since; filter by portfolio or category | quantity, average cost, price, value, unrealised gain |
| `transactions` | date, type, symbol, category, portfolio; filters by symbol, type, date range and portfolio | quantity, price, amount, currency, fees, withholding |
| `performance` | XIRR and net return in % (the app's return figures) | invested, realised, dividends, fees, taxes, net return |
| `dividends` | payments per year (count, dates, symbols) | gross amounts and withholding |
| `tax_summary` | needs `--amounts` | the app's tax report for a year: gains, losses, dividends, interest, withholding, estimated tax (de, at, ch or us) |
| `allocation` | % by category, symbol, portfolio or currency | EUR |

- **Prices** are the latest ones stored in the vault, as of your last price refresh in the app.
- **Tax settings** that live outside the vault (the plain tax settings) use their defaults.
- **Advice:** the figures are estimates, not financial or tax advice.

## Publishing (maintainers)

`npm publish` in this folder. Its `prepack` step copies the app modules the server uses into `app/` (`scripts/vendor.mjs`), so the package runs without the repository.

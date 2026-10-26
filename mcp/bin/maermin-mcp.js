#!/usr/bin/env node
// maermin-mcp: a local, read-only MCP server over a MAERMIN vault backup.
// See mcp/README.md. stdout carries MCP messages only; everything else goes to stderr.
'use strict';
const fs = require('node:fs');
const M = require('../lib/index.js');

const HELP = `maermin-mcp ${M.VERSION} - local, read-only MCP server over your MAERMIN vault

Usage: maermin-mcp --backup <maermin-vault-backup.json> [options]

  --backup <file>        the encrypted backup (settings menu > Backup vault (encrypted))
  --scopes <list>        tools to offer, comma-separated (default: all):
                         ${M.TOOLS.join(', ')}
  --amounts              include quantities, prices and values in EUR (default: percentages only)
  --usd-eur <rate>       EUR per USD; needed when the vault has non-EUR amounts (no default rate)
  --sync <worker-url>    also read the newer sync blob from YOUR OWN Worker (the only network access)
  --password-file <file> read the vault password from a file (else MAERMIN_PASSWORD)

The password is never taken from the command line. The backup is decrypted in
memory on this machine; credentials in it are dropped and never reach a tool.`;

(async function main() {
  const a = M.parseArgs(process.argv.slice(2));
  if (a.help) { process.stderr.write(HELP + '\n'); process.exit(0); }
  if (a.error) { process.stderr.write('maermin-mcp: ' + a.error + '\n'); process.exit(2); }
  const file = a.backup || process.env.MAERMIN_BACKUP;
  if (!file) { process.stderr.write('maermin-mcp: --backup <file> is required.\n\n' + HELP + '\n'); process.exit(2); }
  let password = process.env.MAERMIN_PASSWORD || '';
  if (a.passwordFile) password = fs.readFileSync(a.passwordFile, 'utf8').replace(/\r?\n$/, '');
  if (!password) { process.stderr.write('maermin-mcp: set MAERMIN_PASSWORD or --password-file.\n'); process.exit(2); }
  let backup;
  try { backup = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { process.stderr.write('maermin-mcp: cannot read ' + file + ': ' + e.message + '\n'); process.exit(2); }
  let vault;
  try { vault = await M.openBackup(backup, password, { syncUrl: a.sync }); }
  catch (e) {
    const msg = e.message === 'bad-password' ? 'wrong password' : e.message === 'bad-backup' ? 'not a MAERMIN encrypted vault backup' : e.message;
    process.stderr.write('maermin-mcp: ' + msg + '\n'); process.exit(1);
  }
  password = null;
  const server = M.createServer(vault, { amounts: a.amounts, usdEur: a.usdEur, scopes: a.scopes });
  server.serve(process.stdin, process.stdout);
  process.stderr.write('maermin-mcp ' + M.VERSION + ' ready: ' + server.scopes.join(', ') + (a.amounts ? ' (amounts on)' : ' (amounts hidden)') + '\n');
})();

// ToolBus hardening: symlink escapes, minimal child env, untrusted shell
// strings, and the args-form dispatch from model tool calls.
// Run: node test/hardening.test.mjs
import { mkdtempSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createToolBus } from '../src/tools/bus.mjs';
import { executeToolCalls } from '../src/tools/protocol.mjs';

let passed = 0, failed = 0;
const ok = (name, cond) => { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); };
const throws = async (fn, msg) => { try { await fn(); return false; } catch (e) { return !msg || String(e.message).includes(msg); } };

console.log('tool bus hardening:');
const root = mkdtempSync(join(tmpdir(), 'maermin-bus-'));
const outside = mkdtempSync(join(tmpdir(), 'maermin-outside-'));
const bus = createToolBus({ root });

// symlink escape
mkdirSync(join(root, 'sub'), { recursive: true });
symlinkSync(outside, join(root, 'sub', 'link'));
ok('write through a symlink out of the sandbox is blocked', await throws(() => bus.fs.write('sub/link/pwned.txt', 'x'), 'symlink'));
ok('read through a symlink out of the sandbox is blocked', await throws(() => bus.fs.read('sub/link/anything'), 'symlink'));
ok('normal nested write still works', !!(await bus.fs.write('sub/ok/file.txt', 'hi')));

// minimal env
process.env.MAERMIN_TEST_SECRET = 'shh';
const envOut = await bus.shell.exec('node', { args: ['-e', 'process.stdout.write(String(process.env.MAERMIN_TEST_SECRET))'] });
ok('host secrets are not inherited by child processes', envOut.stdout === 'undefined');
ok('PATH is still available', (await bus.shell.exec('node', { args: ['-e', 'process.stdout.write(process.env.PATH ? "y" : "n")'] })).stdout === 'y');

// model-issued calls
const res = await executeToolCalls(bus, [
  { tool: 'shell.exec', cmd: 'echo hi; cat /etc/passwd' },
  { tool: 'shell.exec', args: ['node', '-e', 'process.stdout.write("argv-ok")'] }
]);
ok('model shell strings are refused by default', res[0].ok === false && /disabled/.test(res[0].error || ''));
ok('model args form runs the program with the right argv', res[1].ok === true && res[1].result.stdout === 'argv-ok');
ok('trusted shell strings (stage verify) still work', (await bus.shell.exec('node -e "process.exit(0)"')).code === 0);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

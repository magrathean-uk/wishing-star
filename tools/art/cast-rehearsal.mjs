// Private, read-only review of the packed character atlases. This is not part of the game build.
//   node tools/art/cast-rehearsal.mjs [--old-ref 1342e23 | --old /path/to/chars]
//        [--new /path/to/chars] [--old-source /path/to/art/src/chars]
//        [--new-source /path/to/art/src/chars] [--port 4189]
// A chars directory contains index.json and the packed .json/.webp pages. A source directory is optional and
// supplies links to the original processed PNG frames. The baseline defaults to the fixed graphics commit.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const help = `Private cast rehearsal, served only on 127.0.0.1.
  node tools/art/cast-rehearsal.mjs [options]

  --old-ref <commit>    Baseline Git commit (default: 1342e23)
  --old <chars-dir>     Baseline packed chars directory instead of a Git commit
  --new <chars-dir>     Candidate packed chars directory (default: this checkout)
  --old-source <dir>    Baseline processed-frame directory, for PNG links
  --new-source <dir>    Candidate processed-frame directory, for PNG links
  --port <number>       Local port (default: 4189; 0 picks a free port)

For a directory at <checkout>/public/assets/chars, the frame directory is inferred as
<checkout>/art/src/chars. Stop the server with Ctrl-C. Nothing is published or changed.`;

function parseArgs(args) {
  const out = {};
  const allowed = new Set(['old-ref', 'old', 'new', 'old-source', 'new-source', 'port']);
  while (args.length) {
    const flag = args.shift();
    if (flag === '--help' || flag === '-h') return { help: true };
    const key = flag?.startsWith('--') ? flag.slice(2) : '';
    if (!allowed.has(key) || !args.length || args[0].startsWith('--')) throw new Error(`Invalid argument: ${flag}`);
    if (key in out) throw new Error(`Repeated option: ${flag}`);
    out[key] = args.shift();
  }
  if (out.old && out['old-ref']) throw new Error('Choose --old or --old-ref, not both.');
  if (out['old-source'] && !out.old) throw new Error('--old-source requires --old.');
  const port = out.port === undefined ? 4189 : Number(out.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
  return { ...out, port };
}

function inferredSource(chars) {
  // Only infer the conventional layout; arbitrary packed directories need --*-source.
  const root = resolve(chars, '../../..');
  return resolve(root, 'public/assets/chars') === chars ? resolve(root, 'art/src/chars') : null;
}

async function gitFile(ref, path) {
  const { stdout } = await execFileAsync('git', ['show', `${ref}:${path}`], {
    cwd: repo,
    encoding: 'buffer',
    maxBuffer: 40 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(help);
    return;
  }
  const newDir = resolve(options.new ?? join(repo, 'public/assets/chars'));
  const candidate = {
    kind: 'directory',
    dir: newDir,
    source: options['new-source'] ? resolve(options['new-source']) : inferredSource(newDir),
  };
  let original;
  if (options.old) {
    const dir = resolve(options.old);
    original = {
      kind: 'directory',
      dir,
      source: options['old-source'] ? resolve(options['old-source']) : inferredSource(dir),
    };
  } else {
    const ref = options['old-ref'] ?? '1342e23';
    // Prevent option injection and allow ordinary local branch, tag and commit names only.
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) || ref.includes('..')) throw new Error('Invalid Git ref.');
    const result = await execFileAsync('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], {
      cwd: repo,
      encoding: 'utf8',
    });
    original = { kind: 'git', ref: result.stdout.trim() };
  }
  const sources = { original, candidate };
  async function packed(source, name) {
    return source.kind === 'git'
      ? gitFile(source.ref, `public/assets/chars/${name}`)
      : readFile(join(source.dir, name));
  }
  async function frame(source, id, name) {
    if (source.kind === 'git') return gitFile(source.ref, `art/src/chars/${id}/${name}`);
    if (!source.source) throw new Error('No processed-frame directory configured.');
    return readFile(join(source.source, id, name));
  }
  // Fail early rather than serve an apparently empty comparison.
  for (const [label, source] of Object.entries(sources)) {
    try {
      const index = JSON.parse(await packed(source, 'index.json'));
      if (!index.sets || !index.groups) throw new Error('Missing sets or groups');
    } catch (error) {
      throw new Error(`${label} index could not be read: ${error.message}`);
    }
  }
  const html = await readFile(join(here, 'cast-rehearsal.html'));
  const script = await readFile(join(here, 'cast-rehearsal.js'));
  const describeSource = (s) =>
    s.kind === 'git'
      ? { label: `Git ${s.ref}`, frames: `Git ${s.ref}:art/src/chars` }
      : { label: s.dir, frames: s.source };
  const info = Buffer.from(
    JSON.stringify({ original: describeSource(original), candidate: describeSource(candidate) }),
  );
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    if (req.method !== 'GET') {
      res.writeHead(405).end('GET only');
      return;
    }
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    if (path === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    try {
      let body;
      let type;
      if (path === '/') {
        body = html;
        type = 'text/html; charset=utf-8';
      } else if (path === '/cast-rehearsal.js') {
        body = script;
        type = 'text/javascript; charset=utf-8';
      } else if (path === '/api/info') {
        body = info;
        type = 'application/json';
      } else {
        const asset = /^\/packed\/(original|candidate)\/(index\.json|[A-Za-z0-9_-]+\.(?:json|webp))$/.exec(path);
        const raw = /^\/frames\/(original|candidate)\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+\.png)$/.exec(path);
        if (asset) {
          body = await packed(sources[asset[1]], asset[2]);
          type = asset[2].endsWith('.webp') ? 'image/webp' : 'application/json';
        } else if (raw) {
          body = await frame(sources[raw[1]], raw[2], raw[3]);
          type = 'image/png';
        } else {
          res.writeHead(404).end('Not found');
          return;
        }
      }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Asset not found in this source');
    }
  });
  await new Promise((ok, fail) => server.once('error', fail).listen(options.port, '127.0.0.1', ok));
  const address = server.address();
  console.log(`Cast rehearsal: http://127.0.0.1:${address.port}/`);
  console.log(`Original: ${describeSource(original).label}`);
  console.log(`Candidate: ${describeSource(candidate).label}`);
  console.log('Read-only local review. Press Ctrl-C to stop.');
}

main().catch((error) => {
  console.error(`Cast rehearsal: ${error.message}`);
  process.exitCode = 1;
});

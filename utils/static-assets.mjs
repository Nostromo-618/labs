import fs from 'node:fs';
import path from 'node:path';

/** Fixed local assets only: no glob parser, arbitrary paths, or remote executable code. */
export function staticAssetsPlugin({ root, litertRoot, ortRoot }) {
  const files = new Map();
  for (const [directory, destination, accept] of [
    [path.join(litertRoot, 'wasm'), 'litert-wasm', () => true],
    [path.join(ortRoot, 'dist'), 'transformers-wasm', (name) => name.startsWith('ort-wasm')],
  ]) {
    for (const name of fs.readdirSync(directory)) {
      const source = path.join(directory, name);
      if (accept(name) && fs.statSync(source).isFile())
        files.set(`/${destination}/${name}`, source);
    }
  }
  let output;
  return {
    name: 'labs-static-assets',
    configResolved(config) {
      if (config.command === 'build') output = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        let url;
        try {
          url = decodeURIComponent((request.url || '').split('?')[0]);
        } catch {
          response.statusCode = 400;
          response.end('Bad path');
          return;
        }
        const source = files.get(url);
        if (!source || !['GET', 'HEAD'].includes(request.method)) return next();
        response.setHeader(
          'Content-Type',
          source.endsWith('.wasm')
            ? 'application/wasm'
            : /\.m?js$/.test(source)
              ? 'text/javascript'
              : 'application/octet-stream',
        );
        response.setHeader('Content-Length', String(fs.statSync(source).size));
        if (request.method === 'HEAD') {
          response.end();
          return;
        }
        const stream = fs.createReadStream(source);
        response.on('close', () => stream.destroy());
        stream.on('error', next).pipe(response);
      });
    },
    async closeBundle() {
      if (!output) return;
      for (const [url, source] of files) {
        const destination = path.join(output, url.slice(1));
        await fs.promises.mkdir(path.dirname(destination), { recursive: true });
        await fs.promises.copyFile(source, destination);
      }
      for (const [source, destination] of [
        ['data/search-manifest.json', 'data/search-manifest.json'],
        ['data/search', 'data/search'],
        ['doc', 'doc'],
        ['favicon.svg', 'favicon.svg'],
      ])
        await fs.promises.cp(path.join(root, source), path.join(output, destination), {
          recursive: true,
        });
    },
  };
}

// Lays the app out the way Cloudflare Pages wants it: the pages, plus the API as _worker.js.
import { cpSync, rmSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'deploy', 'pages', 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, 'public'), dist, { recursive: true });
copyFileSync(join(root, 'src', 'worker.js'), join(dist, '_worker.js'));
// Only API calls run code. Pages, styles and fonts are served as plain files.
writeFileSync(join(dist, '_routes.json'), JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }) + '\n');
console.log('Built ' + dist);

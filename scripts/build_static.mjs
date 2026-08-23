import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(path.join(root, 'web'), output, { recursive: true });
cpSync(path.join(root, 'data'), path.join(output, 'data'), { recursive: true });
console.log('Static site built at ' + output);

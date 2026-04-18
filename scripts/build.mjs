import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = resolve(rootDir, 'src');
const distDir = resolve(rootDir, 'dist');
const cleanOnly = process.argv.includes('--clean');
const passthroughFiles = ['CNAME', '.nojekyll'];

function countFiles(dirPath) {
    let total = 0;

    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        const entryPath = resolve(dirPath, entry.name);
        total += entry.isDirectory() ? countFiles(entryPath) : 1;
    }

    return total;
}

if (!existsSync(sourceDir)) {
    console.error(`Source directory not found: ${sourceDir}`);
    process.exit(1);
}

rmSync(distDir, { recursive: true, force: true });

if (cleanOnly) {
    console.log('Cleaned dist directory.');
    process.exit(0);
}

mkdirSync(distDir, { recursive: true });
cpSync(sourceDir, distDir, { recursive: true, force: true });

for (const fileName of passthroughFiles) {
    const fromPath = resolve(rootDir, fileName);
    const toPath = resolve(distDir, fileName);

    if (existsSync(fromPath)) {
        cpSync(fromPath, toPath, { force: true });
    }
}

console.log(
    `Built ${countFiles(distDir)} files from ${relative(rootDir, sourceDir)} to ${relative(rootDir, distDir)}.`
);
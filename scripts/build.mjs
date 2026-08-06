/**
 * build.mjs — one source tree, four ship targets.
 *
 *   node scripts/build.mjs --target=web|yandex|gameads|jam [--sim] [--clean]
 *
 * A target is a manifest, not a branch in the code: which platform/ and leaderboards/
 * parts get concatenated, whether the Yandex SDK wrapper ships, where the output goes.
 * Every target then runs a token gate over its OWN output — the reason the monolith was
 * split at all is that a store build must not carry another platform's name, not even in
 * a comment or a dead code path. The gate runs before the archive, so a leak can never
 * reach an uploadable zip.
 *
 * dist/ is special: .github/workflows/static.yml publishes the COMMITTED ./dist as the
 * GitHub Pages root on every push, with no build step of its own. So the web target must
 * keep writing exactly there and keep its file list unchanged; the three platform targets
 * only ever write under build/ (git-ignored).
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = resolve(rootDir, 'src');
const passthroughFiles = ['CNAME', '.nojekyll'];

// Canonical concatenation order of the platform layer, also the order index.html lists.
// sim must precede any adapter that fetches a remote SDK: core only starts a boot() when
// nobody answered at load, so with the simulator registered later a --sim build would
// still go to the network.
const PLATFORM_ORDER = ['core', 'gameads', 'jam', 'sim', 'yandex'];

// The game layer talks to window.GameAds / GamePlatform / GameLeaderboards and nothing
// else. A host name reappearing in these three files means the abstraction leaked — and
// unlike an adapter, they ship in EVERY target, so this check is target-independent.
const GAME_LAYER_FILES = ['game.js', 'adventure.js', 'levels.js'];
const GAME_LAYER_TOKENS = ['YandexSDK', 'RewardHub', 'AdsBridge', 'AdsManager', 'window.Jam', '__adsSim'];

const GATE_EXTENSIONS = ['.js', '.html', '.css', '.json'];

// Vendored and minified: its mangled identifiers contain fragments that read as real
// tokens (`ym(` and friends), so scanning it yields only false positives.
const GATE_SKIP_FILES = ['pixi.min.js'];

const TARGETS = {
    // Public site, and the only place with a dev story: everything ships, the simulator
    // included, and there is nobody to hide anything from — hence no token gate.
    web: {
        platform: ['core', 'gameads', 'jam', 'sim', 'yandex'],
        leaderboards: ['core', 'ui', 'jam', 'yandex'],
        yandexSdk: true,
        outDir: 'dist',
        zipPath: 'block_chpock.zip',
        forbidden: [],
    },
    yandex: {
        platform: ['core', 'yandex'],
        leaderboards: ['core', 'ui', 'yandex'],
        yandexSdk: true,
        outDir: 'build/yandex',
        zipPath: 'build/block_chpok-yandex.zip',
        forbidden: ['RewardHub', 'AdsBridge', 'AdsManager', 'AppLovin', 'jam'],
    },
    // Rewarded hub / native APK shell. No leaderboards at all: they are not part of that
    // contract, so shipping the UI would offer the player a board nothing can fill.
    gameads: {
        platform: ['core', 'gameads'],
        leaderboards: ['core'],
        yandexSdk: false,
        outDir: 'build/gameads',
        zipPath: 'build/block_chpok-gameads.zip',
        forbidden: ['YandexSDK', 'mc.yandex.ru', '/sdk.js'],
    },
    jam: {
        platform: ['core', 'jam'],
        leaderboards: ['core', 'ui', 'jam'],
        yandexSdk: false,
        outDir: 'build/jam',
        zipPath: 'build/block_chpok-jam.zip',
        forbidden: ['YandexSDK', 'mc.yandex.ru', '/sdk.js', 'AdsBridge', 'AppLovin'],
    },
};

const args = process.argv.slice(2);
const cleanOnly = args.includes('--clean');
const withSim = args.includes('--sim');
const targetArg = args.find((arg) => arg.startsWith('--target='));
const targetName = targetArg ? targetArg.slice('--target='.length) : 'web';
const target = TARGETS[targetName];

if (!target) {
    console.error(`Unknown target "${targetName}". Known targets: ${Object.keys(TARGETS).join(', ')}.`);
    process.exit(1);
}

if (!existsSync(sourceDir)) {
    console.error(`Source directory not found: ${sourceDir}`);
    process.exit(1);
}

const outDir = resolve(rootDir, target.outDir);
const outLabel = relative(rootDir, outDir).split(sep).join('/');

function countFiles(dirPath) {
    let total = 0;

    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        const entryPath = resolve(dirPath, entry.name);
        total += entry.isDirectory() ? countFiles(entryPath) : 1;
    }

    return total;
}

function collectFiles(dirPath, found = []) {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        const entryPath = resolve(dirPath, entry.name);

        if (entry.isDirectory()) {
            collectFiles(entryPath, found);
        } else {
            found.push(entryPath);
        }
    }

    return found;
}

function platformParts() {
    const parts = target.platform.slice();

    // --sim is for QA of a RELEASE build, so it must land in the canonical slot rather
    // than at the end, where it would register after the SDK-loading adapter.
    if (withSim && !parts.includes('sim')) parts.push('sim');

    return parts.sort((a, b) => PLATFORM_ORDER.indexOf(a) - PLATFORM_ORDER.indexOf(b));
}

/**
 * Concatenates layer parts into a single file, or reports that the layer ships nothing.
 */
function bundleLayer(layerDir, parts, outFile) {
    if (parts.length === 0) return false;

    const chunks = parts.map((part) => {
        const partPath = resolve(sourceDir, layerDir, `${part}.js`);

        if (!existsSync(partPath)) {
            const shown = relative(rootDir, partPath).split(sep).join('/');
            console.error(`Missing ${layerDir} part for target "${targetName}": ${shown}`);
            process.exit(1);
        }

        return readFileSync(partPath, 'utf8');
    });

    // ';\n' and not '' or '\n': one part may lack a trailing newline, and naive
    // concatenation then produces `})()(function () { ... })()` — a call on the previous
    // IIFE's undefined result. That breaks only the BUILT file, which is the worst
    // possible place to discover it.
    let bundle = chunks.join(';\n');
    if (!bundle.endsWith('\n')) bundle += '\n';

    writeFileSync(outFile, bundle);
    return true;
}

/**
 * Collapses a <!-- build:<name> --> ... <!-- /build:<name> --> block into a single tag,
 * or drops it whole when the layer ships nothing (referencing a file we did not write
 * would be a guaranteed 404).
 */
function replaceLayerBlock(html, name, tag) {
    const pattern = new RegExp(
        `([ \\t]*)<!--\\s*build:${name}\\s*-->[\\s\\S]*?<!--\\s*/build:${name}\\s*-->[ \\t]*(\\r?\\n)?`,
        'g'
    );

    let replaced = false;

    const result = html.replace(pattern, (match, indent, eol) => {
        replaced = true;
        return tag ? `${indent}${tag}${eol || ''}` : '';
    });

    if (!replaced) {
        console.error(`index.html has no <!-- build:${name} --> block — script tags cannot be rewritten.`);
        process.exit(1);
    }

    return result;
}

/**
 * <!-- build:only a,b --> keeps its body (markers stripped) for the listed targets and
 * deletes it entirely for the rest.
 */
function applyOnlyBlocks(html, name) {
    const pattern =
        /([ \t]*)<!--\s*build:only\s+([^>]*?)\s*-->[ \t]*\r?\n?([\s\S]*?)[ \t]*<!--\s*\/build:only\s*-->[ \t]*(\r?\n)?/g;

    return html.replace(pattern, (match, indent, list, body) => {
        const allowed = list.split(',').map((entry) => entry.trim()).filter(Boolean);
        return allowed.includes(name) ? body : '';
    });
}

function tokensFor(filePath) {
    const tokens = target.forbidden.slice();

    if (GAME_LAYER_FILES.includes(basename(filePath))) {
        for (const token of GAME_LAYER_TOKENS) {
            if (!tokens.includes(token)) tokens.push(token);
        }
    }

    return tokens;
}

function runTokenGate() {
    const violations = [];

    for (const filePath of collectFiles(outDir)) {
        if (!GATE_EXTENSIONS.includes(extname(filePath).toLowerCase())) continue;
        if (GATE_SKIP_FILES.includes(basename(filePath))) continue;

        const tokens = tokensFor(filePath);
        if (tokens.length === 0) continue;

        const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);

        lines.forEach((line, index) => {
            const haystack = line.toLowerCase();

            for (const token of tokens) {
                if (!haystack.includes(token.toLowerCase())) continue;

                violations.push({
                    file: relative(rootDir, filePath).split(sep).join('/'),
                    line: index + 1,
                    token,
                    text: line.trim().slice(0, 160),
                });
            }
        });
    }

    return violations;
}

// 1. A target always builds from scratch: a part that stopped shipping must not survive
//    as a stale file in the output.
rmSync(outDir, { recursive: true, force: true });

if (cleanOnly) {
    console.log(`Cleaned ${outLabel} directory.`);
    process.exit(0);
}

mkdirSync(outDir, { recursive: true });

// 2. Copy src/ verbatim except the layer sources: the split parts are concatenated below
//    under their final names, the two monoliths they replace are dead weight, and the SDK
//    wrapper only exists for a host that serves the SDK.
const skipFromSource = new Set(['platform', 'leaderboards', 'platform.js', 'leaderboards.js']);
if (!target.yandexSdk) skipFromSource.add('yandex-sdk.js');

cpSync(sourceDir, outDir, {
    recursive: true,
    force: true,
    filter: (from) => {
        const rel = relative(sourceDir, from).split(sep).join('/');
        return rel === '' || !skipFromSource.has(rel);
    },
});

// The filter above is the fast path, not the guarantee. Whether a rejected directory prunes
// its whole subtree is a detail of the copy implementation, and the cost of one leaked part
// is another platform's SDK sitting inside a store build. So delete the excluded paths
// outright afterwards, then refuse to continue if anything survived — a silent leak here is
// exactly the failure this build exists to prevent.
for (const entry of skipFromSource) {
    rmSync(resolve(outDir, entry), { recursive: true, force: true });
}

const leaked = [...skipFromSource].filter((entry) => existsSync(resolve(outDir, entry)));

if (leaked.length > 0) {
    console.error(
        `Failed to exclude layer sources from ${outLabel}: ${leaked.join(', ')}. ` +
        'Refusing to build — the output would carry sources meant for another target.'
    );
    process.exit(1);
}

// 3. Bundle the two layers.
const parts = platformParts();
const leaderboardParts = target.leaderboards.slice();
const hasPlatform = bundleLayer('platform', parts, resolve(outDir, 'platform.js'));
const hasLeaderboards = bundleLayer('leaderboards', leaderboardParts, resolve(outDir, 'leaderboards.js'));

// 4. Rewrite index.html: layer blocks become one tag each, build:only blocks are kept or
//    cut per target.
const indexPath = resolve(outDir, 'index.html');

if (!existsSync(indexPath)) {
    console.error(`index.html missing from ${outLabel}.`);
    process.exit(1);
}

let html = readFileSync(indexPath, 'utf8');
html = replaceLayerBlock(html, 'platform', hasPlatform ? '<script src="platform.js"></script>' : null);
html = replaceLayerBlock(html, 'leaderboards', hasLeaderboards ? '<script src="leaderboards.js"></script>' : null);
html = applyOnlyBlocks(html, targetName);

// A leftover marker means a malformed block, and a build:only whose markers survived
// would ship its body to a target that must not have it.
if (/<!--\s*\/?\s*build:/.test(html)) {
    console.error('Unprocessed build marker left in index.html — check that every block is closed.');
    process.exit(1);
}

writeFileSync(indexPath, html);

// 5. Root-level hosting files that are not part of src/.
for (const fileName of passthroughFiles) {
    const fromPath = resolve(rootDir, fileName);
    const toPath = resolve(outDir, fileName);

    if (existsSync(fromPath)) {
        cpSync(fromPath, toPath, { force: true });
    }
}

console.log(
    `Built target "${targetName}": ${countFiles(outDir)} files in ${outLabel} ` +
    `(platform: ${parts.join(' + ')}; leaderboards: ${leaderboardParts.join(' + ') || 'none'}).`
);

// 6. Token gate. Fails the build before anything uploadable exists.
const violations = runTokenGate();

if (violations.length > 0) {
    console.error(`\nToken gate failed for target "${targetName}" — ${violations.length} forbidden reference(s):`);

    for (const violation of violations) {
        console.error(`  ${violation.file}:${violation.line}  [${violation.token}]  ${violation.text}`);
    }

    console.error('\nNo archive was created. Move the offending code into a host adapter or drop it.');
    process.exit(1);
}

// 7. Archive.
try {
    const zipPath = resolve(rootDir, target.zipPath);
    mkdirSync(dirname(zipPath), { recursive: true });

    // Removed first so a failed tar leaves no stale archive to be uploaded by mistake.
    rmSync(zipPath, { force: true });

    // Relative to the output dir on purpose: an absolute Windows path starts with a
    // drive-letter colon, which GNU tar (the one on PATH in a POSIX shell) reads as a
    // remote host spec and refuses.
    const zipArg = relative(outDir, zipPath).split(sep).join('/');
    execSync(`tar -a -c -f "${zipArg}" *`, { cwd: outDir, stdio: 'inherit' });
    console.log(`Created archive at ${relative(rootDir, zipPath).split(sep).join('/')}`);
} catch (error) {
    console.error('Failed to create zip archive:', error.message);
}

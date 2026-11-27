#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const defaultOutput = path.join(projectRoot, 'release');
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function usage() {
    console.log([
        'Usage:',
        '  node scripts/remote-release.cjs stage <version> [--source <remote-dir>] [--out <dir>] [--fallback <version>]',
        '  node scripts/remote-release.cjs activate <version> [--out <dir>]',
        '  node scripts/remote-release.cjs rollback <version> [--out <dir>]',
        '  node scripts/remote-release.cjs verify [--out <dir>]',
        '',
        'stage never overwrites an existing remote_v<version> directory.',
        'activate/rollback only rewrite config/remote_version.json; uploaded bundles are immutable.',
    ].join('\n'));
}

function parseArgs(argv) {
    const options = {};
    const positional = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) {
            positional.push(arg);
            continue;
        }
        const equals = arg.indexOf('=');
        if (equals > 0) {
            options[arg.slice(2, equals)] = arg.slice(equals + 1);
            continue;
        }
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
            options[key] = next;
            i++;
        } else {
            options[key] = true;
        }
    }
    return { positional, options };
}

function version(value, label = 'version') {
    if (typeof value !== 'string') throw new Error(`${label} is required`);
    const normalized = value.trim().replace(/^v/i, '');
    if (!versionPattern.test(normalized)) throw new Error(`invalid ${label}: ${value}`);
    return normalized;
}

function resolvePath(value, fallback) {
    return path.resolve(projectRoot, typeof value === 'string' ? value : fallback);
}

function manifestPath(output) {
    return path.join(output, 'config', 'remote_version.json');
}

function readManifest(output) {
    const file = manifestPath(output);
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { throw new Error(`invalid manifest ${file}: ${error.message}`); }
}

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(temporary, file);
}

function bundleNames(remoteDirectory) {
    return fs.readdirSync(remoteDirectory, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .filter(name => /^[a-z][a-z0-9_]*$/.test(name))
        .sort();
}

function listFiles(directory, prefix = '') {
    const rows = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) rows.push(...listFiles(absolute, relative));
        else if (entry.isFile()) rows.push({ relative, absolute, size: fs.statSync(absolute).size });
    }
    return rows;
}

function inspectRemote(remoteDirectory) {
    const files = listFiles(remoteDirectory);
    const digest = crypto.createHash('sha256');
    let totalBytes = 0;
    for (const file of files) {
        totalBytes += file.size;
        digest.update(file.relative);
        digest.update('\0');
        digest.update(String(file.size));
        digest.update('\0');
        digest.update(crypto.createHash('sha256').update(fs.readFileSync(file.absolute)).digest('hex'));
        digest.update('\n');
    }
    return { files: files.length, bytes: totalBytes, sha256: digest.digest('hex') };
}

function remoteDirectory(output, selectedVersion) {
    return path.join(output, `remote_v${selectedVersion}`, 'remote');
}

function assertBundleConfig(directory, name) {
    const bundleDirectory = path.join(directory, name);
    const files = fs.existsSync(bundleDirectory) ? fs.readdirSync(bundleDirectory) : [];
    const configs = files.filter(file => /^config\.[0-9a-f]{5,32}\.json$/.test(file));
    if (!configs.length) throw new Error(
        `missing MD5 bundle config for ${name} at ${bundleDirectory}; enable md5Cache before building`,
    );
}

function stage(command, options) {
    const selectedVersion = version(command, 'version');
    const source = resolvePath(options.source, 'build/wechatgame/remote');
    const output = resolvePath(options.out, defaultOutput);
    if (!fs.existsSync(source) || !fs.statSync(source).isDirectory())
        throw new Error(`remote source not found: ${source}`);
    const bundles = bundleNames(source);
    if (!bundles.length) throw new Error(`remote source has no bundle directories: ${source}`);

    const target = remoteDirectory(output, selectedVersion);
    if (fs.existsSync(target)) {
        throw new Error(`refusing to overwrite immutable release: ${target}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
    for (const name of bundles) assertBundleConfig(target, name);

    const existing = readManifest(output);
    const previous = existing?.current && version(existing.current) !== selectedVersion
        ? version(existing.current) : existing?.previous;
    const fallback = options.fallback ? version(options.fallback, 'fallback')
        : previous || existing?.fallback || selectedVersion;
    const updatedAt = new Date().toISOString();
    const release = {
        schema: 1,
        version: selectedVersion,
        generatedAt: updatedAt,
        source: path.relative(projectRoot, source),
        bundles,
        ...inspectRemote(target),
    };
    writeJson(path.join(path.dirname(target), 'release.json'), release);

    const manifest = {
        schema: 1,
        current: selectedVersion,
        fallback: version(fallback, 'fallback'),
        previous,
        rollback_to: null,
        next: null,
        gray_percent: 0,
        force_restart: false,
        bundles: Object.fromEntries(bundles.map(name => [name, selectedVersion])),
        updated_at: updatedAt,
    };
    writeJson(manifestPath(output), manifest);
    console.log(`[remote] staged ${selectedVersion}: ${bundles.length} bundles, ${release.files} files, ${release.bytes} bytes`);
    console.log(`[remote] digest ${release.sha256}`);
    console.log(`[remote] upload ${path.dirname(target)}/ -> cos://<bucket>/<cdn-root>/remote_v${selectedVersion}/`);
    console.log(`[remote] upload ${manifestPath(output)} -> cos://<bucket>/<cdn-root>/config/remote_version.json`);
}

function activate(command, options, rollback) {
    const selectedVersion = version(command, 'version');
    const output = resolvePath(options.out, defaultOutput);
    const existing = readManifest(output);
    if (!existing) throw new Error(`manifest not found: ${manifestPath(output)}`);
    const target = remoteDirectory(output, selectedVersion);
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory())
        throw new Error(`remote version is not staged: ${target}`);

    const previousCurrent = existing.current ? version(existing.current) : undefined;
    const bundleKeys = Object.keys(existing.bundles || {});
    for (const name of bundleKeys) assertBundleConfig(target, name);
    const updatedAt = new Date().toISOString();
    const manifest = {
        ...existing,
        schema: 1,
        current: selectedVersion,
        fallback: rollback && previousCurrent && previousCurrent !== selectedVersion
            ? previousCurrent : version(existing.fallback || selectedVersion),
        previous: previousCurrent && previousCurrent !== selectedVersion ? previousCurrent : existing.previous || null,
        rollback_to: null,
        updated_at: updatedAt,
        bundles: Object.fromEntries(bundleKeys.map(name => [name, selectedVersion])),
    };
    writeJson(manifestPath(output), manifest);
    console.log(`[remote] ${rollback ? 'rolled back' : 'activated'} ${selectedVersion}`);
    console.log(`[remote] upload ${manifestPath(output)} -> cos://<bucket>/<cdn-root>/config/remote_version.json`);
}

function verify(options) {
    const output = resolvePath(options.out, defaultOutput);
    const manifest = readManifest(output);
    if (!manifest) throw new Error(`manifest not found: ${manifestPath(output)}`);
    const selected = version(manifest.current);
    const bundleVersions = manifest.bundles && typeof manifest.bundles === 'object' ? manifest.bundles : {};
    const checks = Object.entries(bundleVersions);
    if (!checks.length) throw new Error('manifest has no bundle mappings');
    for (const [name, value] of checks) {
        assertBundleConfig(remoteDirectory(output, version(value, `${name} version`)), name);
    }
    console.log(`[remote] verified current=${selected}, ${checks.length} bundle mappings`);
}

try {
    const { positional, options } = parseArgs(process.argv.slice(2));
    const [command, value] = positional;
    if (!command || command === 'help' || command === '--help') usage();
    else if (command === 'stage') stage(value, options);
    else if (command === 'activate') activate(value, options, false);
    else if (command === 'rollback') activate(value, options, true);
    else if (command === 'verify') verify(options);
    else {
        usage();
        process.exitCode = 1;
    }
} catch (error) {
    console.error(`[remote] ${error.message}`);
    process.exitCode = 1;
}

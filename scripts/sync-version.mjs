/**
 * @fileoverview Synchroniseur automatique de version pour Check Anime & Scans.
 * Aligne manifest.json et package.json sur la source unique de vérité : pwa/version.js.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const versionJsPath = resolve(rootDir, 'pwa/version.js');
const manifestPath = resolve(rootDir, 'manifest.json');
const packagePath = resolve(rootDir, 'package.json');

const versionContent = readFileSync(versionJsPath, 'utf-8');
const match = versionContent.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);

if (!match) {
    console.error('Impossible de trouver APP_VERSION dans pwa/version.js');
    process.exit(1);
}

const currentVersion = match[1];

// 1. Synchroniser manifest.json
const manifestContent = readFileSync(manifestPath, 'utf-8');
const manifest = JSON.parse(manifestContent);
if (manifest.version !== currentVersion) {
    manifest.version = currentVersion;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    console.log(`[Version Sync] manifest.json synchronisé vers v${currentVersion}`);
}

// 2. Synchroniser package.json
const packageContent = readFileSync(packagePath, 'utf-8');
const pkg = JSON.parse(packageContent);
if (pkg.version !== currentVersion) {
    pkg.version = currentVersion;
    writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    console.log(`[Version Sync] package.json synchronisé vers v${currentVersion}`);
}

console.log(`✓ Version unique vérifiée et alignée : v${currentVersion}`);

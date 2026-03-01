#!/usr/bin/env node
/**
 * EAS build hook: upload JS source maps to Sentry after a successful build
 * so that production crashes are symbolicated. Runs only when SENTRY_AUTH_TOKEN
 * is set. Does not fail the build if upload fails (logs a clear warning).
 *
 * Release name: ${CFBundleShortVersionString}+${CFBundleVersion} from built
 * app Info.plist (iOS) or versionCode from build (Android), or fallback
 * ${version}+${EAS_BUILD_ID}.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function log(msg) {
  console.log(`[Sentry upload] ${msg}`);
}

function warn(msg) {
  console.warn(`[Sentry upload] WARNING: ${msg}`);
}

function getReleaseFromIosPlist() {
  const iosBuild = path.join(ROOT, 'ios', 'build', 'Build', 'Products');
  if (!fs.existsSync(iosBuild)) return null;
  let plistPath = null;
  try {
    const configs = fs.readdirSync(iosBuild);
    for (const config of configs) {
      const dir = path.join(iosBuild, config);
      if (!fs.statSync(dir).isDirectory()) continue;
      const apps = fs.readdirSync(dir).filter((f) => f.endsWith('.app'));
      if (apps.length === 0) continue;
      plistPath = path.join(dir, apps[0], 'Info.plist');
      if (fs.existsSync(plistPath)) break;
    }
  } catch (_) {
    return null;
  }
  if (!plistPath || !fs.existsSync(plistPath)) return null;
  try {
    const plist = fs.readFileSync(plistPath, 'utf8');
    const versionMatch = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
    const buildMatch = plist.match(/<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/);
    const version = versionMatch ? versionMatch[1].trim() : null;
    const build = buildMatch ? buildMatch[1].trim() : null;
    if (version && build) return `${version}+${build}`;
  } catch (_) {}
  return null;
}

function findSourceMapFiles() {
  const files = [];
  const scan = (dir, depth) => {
    if (depth > 6) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git') scan(full, depth + 1);
        else if (e.isFile() && (e.name.endsWith('.map') || e.name.endsWith('.jsbundle.map'))) files.push(full);
      }
    } catch (_) {}
  };
  scan(path.join(ROOT, 'ios', 'build'), 0);
  scan(path.join(ROOT, 'android', 'app', 'build'), 0);
  return files;
}

function main() {
  if (process.env.EAS_BUILD !== 'true') {
    log('Skipping (not an EAS build).');
    return;
  }
  if (!process.env.SENTRY_AUTH_TOKEN) {
    log('Skipping (SENTRY_AUTH_TOKEN not set).');
    return;
  }

  const platform = process.env.EAS_BUILD_PLATFORM || 'ios';
  let release = null;
  if (platform === 'ios') {
    release = getReleaseFromIosPlist();
  }
  if (!release) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
      const version = pkg.version || '1.0.0';
      const buildId = process.env.EAS_BUILD_ID || '0';
      release = `${version}+${buildId}`;
    } catch (_) {
      release = `1.0.0+${process.env.EAS_BUILD_ID || '0'}`;
    }
  }

  const sourceMapFiles = findSourceMapFiles();
  if (sourceMapFiles.length === 0) {
    warn('No source map files found under ios/build or android/app/build. Upload skipped. Plugin may still have uploaded during native build.');
    return;
  }

  const uploadDirs = [...new Set(sourceMapFiles.map((f) => path.dirname(f)))];
  log(`Found ${sourceMapFiles.length} source map file(s) in ${uploadDirs.length} dir(s), release ${release}`);

  for (const uploadDir of uploadDirs) {
    try {
      execSync(
        `npx sentry-cli releases files "${release}" upload-sourcemaps "${uploadDir}" --rewrite`,
        {
          stdio: 'inherit',
          env: { ...process.env, SENTRY_LOG_LEVEL: process.env.SENTRY_LOG_LEVEL || 'debug' },
          cwd: ROOT,
        }
      );
      log(`Uploaded source maps from ${uploadDir}`);
    } catch (err) {
      warn(`Source map upload failed for ${uploadDir} (build not failed): ${err.message || err}`);
    }
  }
}

main();

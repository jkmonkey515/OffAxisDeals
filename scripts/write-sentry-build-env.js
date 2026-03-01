#!/usr/bin/env node
/**
 * Writes .env.sentry-build-plugin from environment variables so the Sentry
 * native build step (Xcode/Gradle) can authenticate during EAS Build.
 * Run from postinstall when SENTRY_AUTH_TOKEN is set (e.g. on EAS).
 */
const fs = require('fs');
const path = require('path');

const token = process.env.SENTRY_AUTH_TOKEN;
if (!token) process.exit(0);

const lines = [`SENTRY_AUTH_TOKEN=${token}`];
if (process.env.SENTRY_ORG) lines.push(`SENTRY_ORG=${process.env.SENTRY_ORG}`);
if (process.env.SENTRY_PROJECT) lines.push(`SENTRY_PROJECT=${process.env.SENTRY_PROJECT}`);

const outPath = path.join(__dirname, '..', '.env.sentry-build-plugin');
fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');

#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const errors = [];
const warnings = [];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  } catch (err) {
    errors.push(`${file}: ${err.message}`);
    return null;
  }
}

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const manifest = readJson("manifest.json");

if (manifest) {
  if (manifest.manifest_version !== 3) {
    errors.push("manifest.json must use manifest_version 3.");
  }
  if (!manifest.name || !manifest.description || !manifest.version) {
    errors.push("manifest.json must include name, description, and version.");
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version || "")) {
    errors.push("manifest.json version should be semantic x.y.z.");
  }
  if ((manifest.description || "").length > 132) {
    errors.push("manifest.json description must be 132 characters or fewer.");
  }
  for (const size of ["16", "48", "128"]) {
    const icon = manifest.icons && manifest.icons[size];
    if (!icon || !exists(icon)) errors.push(`Missing ${size}px icon at ${icon || "(not declared)"}.`);
  }
  if (manifest.background && manifest.background.service_worker && !exists(manifest.background.service_worker)) {
    errors.push(`Missing service worker: ${manifest.background.service_worker}`);
  }
  if (manifest.side_panel && manifest.side_panel.default_path && !exists(manifest.side_panel.default_path)) {
    errors.push(`Missing side panel file: ${manifest.side_panel.default_path}`);
  }
}

for (const required of ["README.md", "LICENSE", "PRIVACY.md", "CHANGELOG.md", "STORE_REVIEW.md"]) {
  if (!exists(required)) errors.push(`Missing ${required}.`);
}

for (const file of walk(root)) {
  if (!file.endsWith(".js") && !file.endsWith(".html")) continue;
  const rel = path.relative(root, file);
  const text = fs.readFileSync(file, "utf8");

  const forbidden = [
    /\beval\s*\(/,
    /\bnew\s+Function\s*\(/,
    /\bimportScripts\s*\(\s*["']https?:\/\//,
    /<script[^>]+src=["']https?:\/\//i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(text)) errors.push(`${rel}: forbidden remote/dynamic executable code pattern ${pattern}`);
  }
}

if (warnings.length) {
  console.warn(warnings.map((msg) => `Warning: ${msg}`).join("\n"));
}

if (errors.length) {
  console.error(errors.map((msg) => `Error: ${msg}`).join("\n"));
  process.exit(1);
}

console.log("Extension validation passed.");

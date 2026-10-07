/**
 * Checks that registry.json and the prebuilt items in public/r agree with the source in this repository:
 * every listed file exists, every item has a prebuilt JSON file, every dependency is a real package name, every file
 * installs where scripts/registry-install.mjs says, and the embedded content matches the source with its imports rewritten
 * for that install layout. It also fails when two items export the same name, so every item can be re-exported from one index.ts.
 *
 *   npm run check:registry
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { exportedNames, importSpecifiers, installTarget, isPackageName, withRelativeImports } from "./registry-install.mjs";

const registry = JSON.parse(await readFile("registry.json", "utf8"));
const problems = [];
const exists = async file => { try { return (await stat(file)).isFile(); } catch { return false; } };

async function findFile(importPath) {
  for (const candidate of [importPath, `${importPath}.ts`, `${importPath}.tsx`, `${importPath}.css`, `${importPath}.module.css`, path.join(importPath, "index.ts"), path.join(importPath, "index.tsx")]) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}
const resolveFrom = file => specifier => {
  if (specifier.startsWith("./") || specifier.startsWith("../")) return findFile(path.normalize(path.join(path.dirname(file), specifier)));
  if (specifier.startsWith("@/")) return findFile(specifier.slice(2));
  return null;
};
/** The content a registry item should embed for `file`: the source, with imports rewritten for the install layout. */
async function expected(file) {
  const source = await readFile(file, "utf8");
  return /\.(?:tsx?|css)$/.test(file) ? withRelativeImports(file, source, importSpecifiers(file, source), resolveFrom(file)) : source;
}

for (const item of registry.items) {
  const built = `public/r/${item.name}.json`;
  if (!(await exists(built))) { problems.push(`${item.name}: missing ${built}`); continue; }
  const prebuilt = JSON.parse(await readFile(built, "utf8"));
  if (prebuilt.name !== item.name) problems.push(`${built}: name is ${prebuilt.name}`);
  for (const dependency of prebuilt.dependencies ?? []) if (!isPackageName(dependency)) problems.push(`${item.name}: ${JSON.stringify(dependency)} is not an npm package name`);
  for (const file of item.files) {
    if (!(await exists(file.path))) { problems.push(`${item.name}: missing source ${file.path}`); continue; }
    if (file.target !== installTarget(file.path)) problems.push(`${item.name}: ${file.path} targets ${file.target}, expected ${installTarget(file.path)}`);
    const embedded = prebuilt.files?.find(entry => entry.path === file.path)?.content;
    if (embedded !== await expected(file.path)) problems.push(`${item.name}: ${built} is out of date for ${file.path}`);
  }
}

// Export names are unique across items (files of one item folder may share a name), so `export *` from every item never hits TS2308.
const exporters = new Map();
const folderOf = file => file.match(/^registry\/(?:components|blocks)\/[a-z0-9-]+/)?.[0] ?? file;
for (const file of new Set(registry.items.flatMap(item => item.files.map(entry => entry.path)))) {
  if (!(await exists(file))) continue;
  for (const name of exportedNames(file, await readFile(file, "utf8"))) {
    if (!exporters.has(name)) exporters.set(name, new Set());
    exporters.get(name).add(folderOf(file));
  }
}
for (const [name, folders] of exporters) if (folders.size > 1) problems.push(`export name ${name} is exported by ${[...folders].sort().join(" and ")}`);

if (problems.length) {
  console.error(`Registry check failed:\n${problems.map(problem => `  - ${problem}`).join("\n")}`);
  process.exit(1);
}
console.log(`Registry OK: ${registry.items.length} items, every file present, installed where it belongs and up to date.`);

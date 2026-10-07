/**
 * Where Arc registry files install in a project, and how their imports are rewritten for it. Shared by every script that
 * builds registry items, and by scripts/check-registry.mjs in the public repository.
 *
 * Every file lands in one `arc/` folder under the project's `components` alias, keeping Arc's own layout:
 *   registry/components/button/button.tsx → arc/button/button.tsx
 *   registry/blocks/sign-in/sign-in.tsx   → arc/blocks/sign-in/sign-in.tsx
 *   registry/foundation.css               → arc/foundation.css
 *   lib/motion-tokens.ts                  → arc/lib/motion-tokens.ts
 * The `@components/` target placeholder resolves from the project's components.json, so `src/` layouts, custom aliases,
 * package imports and monorepo packages all work. Because every file shares that tree, imports between Arc files become
 * relative and never depend on how the project maps `@/*`.
 */
import path from "node:path";
import ts from "typescript";

/**
 * The module specifiers a file really imports. Scripts are parsed with TypeScript and only real import and export
 * declarations, `import()` and `require()` count, so code samples in strings, template literals, JSX text and comments
 * never become dependencies. CSS contributes its `@import` rules and CSS module `composes: … from` references.
 */
export function importSpecifiers(file, content) {
  if (file.endsWith(".css")) {
    return [...content.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']|\bcomposes\s*:[^;]*?\bfrom\s+["']([^"']+)["']/g)].map(match => match[1] ?? match[2]);
  }
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".jsx") ? ts.ScriptKind.JSX : file.endsWith(".js") || file.endsWith(".mjs") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, false, kind);
  const found = [];
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) found.push(node.moduleReference.expression.text);
    else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) found.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** A valid npm package name (optionally scoped), the only thing a registry item may list as a dependency. */
export const isPackageName = name => /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name);

export function installPath(file) {
  if (file.startsWith("registry/components/")) return `arc/${file.slice("registry/components/".length)}`;
  if (file.startsWith("registry/")) return `arc/${file.slice("registry/".length)}`;
  return `arc/${file}`;
}

export const installTarget = file => `@components/${installPath(file)}`;
export const installType = file => (file.startsWith("lib/") ? "registry:lib" : "registry:component");

/**
 * Rewrites each import of another repo file (`@/…` or relative) in `content` to the relative path between the installed
 * locations. `resolve(specifier)` returns the repo file a specifier points at, or null for packages.
 */
export async function withRelativeImports(file, content, specifiers, resolve) {
  let next = content;
  for (const specifier of new Set(specifiers)) {
    const target = await resolve(specifier);
    if (!target) continue;
    let relative = path.posix.relative(path.posix.dirname(installPath(file)), installPath(target));
    if (!relative.startsWith(".")) relative = `./${relative}`;
    // Keep the specifier's own style: extensionless for scripts, explicit for CSS; directory imports keep pointing at the folder.
    if (/\/index\.tsx?$/.test(target) && !/\/index(?:\.tsx?)?$/.test(specifier)) relative = relative.replace(/\/index\.tsx?$/, "");
    else if (/\.tsx?$/.test(target) && !/\.tsx?$/.test(specifier)) relative = relative.replace(/\.tsx?$/, "");
    for (const quote of ["\"", "'"]) next = next.replaceAll(`${quote}${specifier}${quote}`, `${quote}${relative}${quote}`);
  }
  return next;
}

/**
 * The names a script file exports (values and types), without `export default`. Used to keep every public export name unique
 * across registry items, so a project can re-export Arc from one index.ts (kuratlielia/arc-library#12). An alias that
 * re-exports the same binding under another name counts as its own name.
 */
export function exportedNames(file, content) {
  if (!/\.tsx?$/.test(file)) return [];
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, false, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const names = [];
  for (const statement of source.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : [];
    if (modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) && !modifiers.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
      } else if (statement.name && ts.isIdentifier(statement.name)) names.push(statement.name.text);
    }
    // Local `export { a, b as c }` lists; `export … from` re-exports of another Arc file are that file's names, not new ones.
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) names.push(element.name.text);
    }
  }
  return [...new Set(names)];
}

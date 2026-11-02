import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const cache = new Map();

export async function loadTypeScriptModule(relativePath) {
  const filename = path.resolve(new URL(relativePath, import.meta.url).pathname);
  if (cache.has(filename)) return cache.get(filename);

  const source = await readFile(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const imports = [...outputText.matchAll(/from\s+(['"])(\.{1,2}\/[^'"]+)\1/g)];
  let moduleSource = outputText;
  for (const [, quote, specifier] of imports) {
    const dependencyPath = path.resolve(path.dirname(filename), `${specifier}.ts`);
    const dependencyUrl = await loadTypeScriptModule(pathToFileURL(dependencyPath).href);
    moduleSource = moduleSource.replace(`from ${quote}${specifier}${quote}`, `from '${dependencyUrl}'`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`;
  cache.set(filename, url);
  return url;
}

export async function importTypeScriptModule(relativePath) {
  return import(await loadTypeScriptModule(relativePath));
}

#!/usr/bin/env bun
// Print every module (scripts/modules.ts) with its size and who imports it from outside, for
// planning a conversion to the module shape (docs/conventions.md, "`lib/` And `shared/`").
//   bun scripts/module-map.ts                 every module: files, lines, outside importers
//   bun scripts/module-map.ts FOLDER          one module: each outside import, file by file
// Columns: files and lines inside; files outside that import it and their imports; distinct
// modules among those (tests left out); deep imports (past its public files).

import { buildGraph, crossedModule, inside, publicFiles, topModule, userOf } from "./modules.ts";
import { isTest, read, repoFiles } from "./ratchet.ts";

const graph = buildGraph(repoFiles());
const known = new Set(graph.files);
const folder = process.argv[2]?.replace(/\/$/, "");

if (folder) {
  const publics = publicFiles(folder, graph);
  for (const [file, targets] of [...graph.imports].sort()) {
    if (inside(file, folder)) continue;
    for (const target of targets.filter((t) => inside(t, folder))) {
      const how = publics.has(target) ? "public" : "DEEP";
      console.log(`${how}\t${userOf(file)}\t${file} -> ${target.slice(folder.length + 1)}`);
    }
  }
} else {
  const modules = new Map<string, string[]>();
  for (const file of graph.files) {
    const top = topModule(file);
    if (top !== null) modules.set(top, [...(modules.get(top) ?? []), file]);
  }
  console.log("module\tfiles\tlines\timporting files\timports\tmodules\tdeep");
  for (const [top, files] of [...modules].sort()) {
    const lines = files.reduce((sum, file) => sum + read(file).split("\n").length - 1, 0);
    let importers = 0;
    let imports = 0;
    let deep = 0;
    const users = new Set<string>();
    const publics = publicFiles(top, graph);
    for (const [file, targets] of graph.imports) {
      if (inside(file, top)) continue;
      const hits = targets.filter((target) => inside(target, top));
      if (hits.length === 0) continue;
      importers++;
      imports += hits.length;
      if (!isTest(file)) users.add(userOf(file));
      deep += hits.filter((target) => crossedModule(file, target, known) !== null && !publics.has(target)).length;
    }
    console.log(`${top}\t${files.length}\t${lines}\t${importers}\t${imports}\t${users.size}\t${deep}`);
  }
}

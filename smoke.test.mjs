// スモークテスト: Nodeで画面部品なしにロジックが読み込め、サーバー側がロジックを共有していること
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIEW_MODULES = ["dom.js", "render.js", "audio.js", "scoreUi.js", "viewEvents.js", "input.js", "volume.js", "gameStart.js", "main.js", "netClient.js"];

function importClosure(entry) {
  const seen = new Set();
  const stack = [path.resolve(ROOT, entry)];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["'](\.[^"']+)["']/gm)) {
      stack.push(path.resolve(path.dirname(file), m[1]));
    }
  }
  return [...seen].map((f) => path.relative(ROOT, f).split(path.sep).join("/"));
}

test("Node(document なし)で全ロジックモジュールが読み込める", async () => {
  assert.equal(typeof document, "undefined");
  const logicModules = [
    "state", "clock", "random", "events", "actions", "ai", "bomb", "bomberman", "misobon", "chargeShot",
    "misobonLaser", "suddenDeath", "matchRules", "matchTimer", "matchReset", "matchStart", "movementLoop",
    "measureMode", "snapshot", "balance", "mapData", "protocol"
  ];
  for (const name of logicModules) {
    await import(pathToFileURL(path.join(ROOT, "js", `${name}.js`)).href);
  }
});

test("サーバー(roomCore)と測定(measureMode)は、画面・音・入力のモジュールを一切読み込まない", () => {
  for (const entry of ["roomCore.js", "js/measureMode.js", "js/snapshot.js"]) {
    const closure = importClosure(entry);
    const leaked = closure.filter((f) => VIEW_MODULES.includes(path.posix.basename(f)));
    assert.deepEqual(leaked, [], `${entry} が画面系モジュールに依存: ${leaked.join(", ")}`);
  }
});

test("サーバーとブラウザは同じロジックのファイルを使う(コピーを持たない)", () => {
  const server = new Set(importClosure("roomCore.js").filter((f) => f.startsWith("js/")));
  for (const f of ["js/actions.js", "js/movementLoop.js", "js/ai.js", "js/bomb.js", "js/suddenDeath.js", "js/matchRules.js"]) {
    assert.ok(server.has(f), `${f} をサーバーが使っていない`);
  }
  // クライアント側(input/netClient)も同じ actions.js を経由する
  assert.ok(importClosure("js/input.js").includes("js/actions.js"));
});

test("静的配信は ../ やサーバー本体を返さない", async () => {
  const { resolveStaticPath } = await import(pathToFileURL(path.join(ROOT, "staticPath.js")).href);
  const bad = [
    "/../server.js", "/js/../server.js", "/js/..%2fserver.js", "/%2e%2e/server.js", "/..%5cserver.js",
    "/server.js", "/package.json", "/roomCore.js", "/tests/smoke.test.mjs", "/node_modules/ws/package.json",
    "/js//state.js", "/js/./state.js", "/js/state.js%00.png", "/%zz", "js/state.js"
  ];
  for (const u of bad) assert.equal(resolveStaticPath(ROOT, u), null, `${u} が通ってしまう`);
  for (const u of ["/", "/index.html", "/style.css", "/js/state.js", "/assets/explosion-9.mp3", "/js/state.js?x=1"]) {
    const p = resolveStaticPath(ROOT, u);
    assert.ok(p && p.startsWith(ROOT + path.sep), `${u} が配信できない`);
  }
});

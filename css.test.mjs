// 画面が使うクラスに、対応するCSSがあること(チャージ表示やピンクの爆発が無かった不具合の再発防止)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");
const has = (cls) => new RegExp(`\\.${cls.replace(/[-]/g, "\\-")}(?![\\w-])`).test(css);

test("viewEvents / render が classList で付け外しするクラスは、すべてCSSに定義がある", () => {
  const NO_STYLE_OK = new Set(["hidden"]); // hidden は別の定義で足りる
  const missing = new Set();
  for (const f of ["js/viewEvents.js", "js/render.js", "js/netClient.js"]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    for (const m of src.matchAll(/classList\.(add|toggle)\(([^)]*)\)/g)) {
      // add は先頭から続く文字列すべて、toggle は最初の1つ(2つ目以降は条件式)
      const parts = m[2].split(",");
      const names = [];
      for (const part of parts) {
        const q = part.trim().match(/^"([\w-]+)"$/);
        if (!q) break;
        names.push(q[1]);
        if (m[1] === "toggle") break;
      }
      for (const n of names) if (!NO_STYLE_OK.has(n) && !has(n)) missing.add(`${f}: ${n}`);
    }
  }
  assert.deepEqual([...missing], []);
});

test("チャージ表示・爆発・照準・チャージレーザーのCSSが揃っている(2段階目はピンクを含む)", () => {
  for (const cls of ["charging", "charge-ready", "charge-stage-2", "charge-blast", "charge-explosion", "charge-explosion-stage-2", "charge-shot-stage-2", "charge-laser", "misobon-aim-marker", "charge-particle", "rule-row"]) {
    assert.ok(has(cls), `.${cls} のCSSが無い`);
  }
  assert.match(css, /\.charge-particles\.stage-2 \.charge-particle:nth-child\(odd\)/, "2段階目の粒子にピンクが混ざる");
});

test("サドンデス停止段階の選択がスタート画面にある(2段/4段)", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.match(html, /id="sel-sd-stage"/);
  assert.match(html, /<option value="2"/);
  assert.match(html, /<option value="4"/);
});

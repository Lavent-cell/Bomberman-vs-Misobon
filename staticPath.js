// staticPath.js
// 静的配信のパス解決。配信してよいのは index.html / style.css / js/ / assets/ だけ。
// ../ や %2e%2e、バックスラッシュ、NUL を含むものは null(= 404)にする。
import path from "path";

const ALLOWED_FILES = new Set(["/index.html", "/style.css"]);
const ALLOWED_DIRS = ["/js/", "/assets/"];

export function resolveStaticPath(root, rawUrl) {
  if (typeof rawUrl !== "string") return null;
  let p;
  try {
    p = decodeURIComponent(rawUrl.split("?")[0].split("#")[0]);
  } catch (e) {
    return null;
  }
  if (p.includes("\0") || p.includes("\\")) return null;
  if (p === "/") p = "/index.html";
  if (!p.startsWith("/")) return null;
  if (path.posix.normalize(p) !== p) return null; // ".." "." "//" を含む

  if (!ALLOWED_FILES.has(p) && !ALLOWED_DIRS.some((d) => p.startsWith(d))) return null;

  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, "." + p);
  if (!abs.startsWith(rootAbs + path.sep)) return null;
  return abs;
}

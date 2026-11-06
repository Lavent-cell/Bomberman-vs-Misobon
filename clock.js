// js/clock.js
const realBackend = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h),
  requestFrame: (fn) => (typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame(fn) : setTimeout(() => fn(realBackend.now()), 16)),
  cancelFrame: (h) => (typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame(h) : clearTimeout(h))
};

let backend = realBackend;
const pending = new Map();
let nextId = 1;

function register(kind, handle, keep) {
  const id = nextId++;
  pending.set(id, { kind, handle, keep: !!keep });
  return id;
}

export const clock = {
  now() { return backend.now(); },
  setTimeout(fn, ms, opts = {}) {
    let id = null;
    const handle = backend.setTimeout(() => {
      pending.delete(id);
      fn();
    }, ms);
    id = register("timeout", handle, opts.keep);
    return id;
  },
  clearTimeout(id) {
    const entry = pending.get(id);
    if (!entry) return;
    backend.clearTimeout(entry.handle);
    pending.delete(id);
  },
  setInterval(fn, ms, opts = {}) {
    const handle = backend.setInterval(fn, ms);
    return register("interval", handle, opts.keep);
  },
  clearInterval(id) {
    const entry = pending.get(id);
    if (!entry) return;
    backend.clearInterval(entry.handle);
    pending.delete(id);
  },
  requestFrame(fn, opts = {}) {
    let id = null;
    const handle = backend.requestFrame((ts) => {
      pending.delete(id);
      fn(ts);
    });
    id = register("frame", handle, opts.keep);
    return id;
  },
  cancelFrame(id) {
    const entry = pending.get(id);
    if (!entry) return;
    backend.cancelFrame(entry.handle);
    pending.delete(id);
  },
  cancelAll(includeKeep = false) {
    for (const [id, entry] of [...pending]) {
      if (entry.keep && !includeKeep) continue;
      if (entry.kind === "timeout") backend.clearTimeout(entry.handle);
      else if (entry.kind === "interval") backend.clearInterval(entry.handle);
      else backend.cancelFrame(entry.handle);
      pending.delete(id);
    }
  },
  pendingCount() {
    let n = 0;
    for (const entry of pending.values()) if (!entry.keep) n++;
    return n;
  },
  setBackend(next) { backend = next || realBackend; },
  useRealBackend() { backend = realBackend; }
};

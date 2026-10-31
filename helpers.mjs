// テスト共通部品
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, timeoutMs = 3000, stepMs = 10) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error("waitFor: タイムアウト");
    await sleep(stepMs);
  }
}

// ws の接続と同じ形(send / close / readyState)の疑似接続
export class FakeConn {
  constructor() { this.readyState = 1; this.inbox = []; this.closed = null; }
  send(str) { this.inbox.push(JSON.parse(str)); }
  close(code, reason) { this.closed = { code, reason }; this.readyState = 3; }
  last(type) { for (let i = this.inbox.length - 1; i >= 0; i--) if (this.inbox[i].type === type) return this.inbox[i]; return null; }
  all(type) { return this.inbox.filter((m) => m.type === type); }
  errors() { return this.all("ERROR").map((e) => e.code); }
}

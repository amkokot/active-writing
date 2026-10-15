import assert from "node:assert/strict";
import { test } from "node:test";
import { IdleCompilation, compilePause, type IdleCompileTarget } from "../src/idleCompilation.ts";

function fixture(run?: () => Promise<void>) {
  let now = 0, next = 0, calls = 0, allowed = true;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const schedule = ((callback: () => void, delay: number) => { const id = ++next; timers.set(id, { at: now + delay, callback }); return id; }) as unknown as typeof setTimeout;
  const cancel = ((id: number) => timers.delete(id)) as unknown as typeof clearTimeout;
  const idle = new IdleCompilation(async () => { calls++; await run?.(); }, () => allowed, schedule, cancel);
  const target: IdleCompileTarget = { enabled: true, projectId: "paper", key: "revision-a", viewKey: "window-a", needsCompile: true, blocked: false, blockWindow: true };
  async function advance(ms: number) {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].callback();
      for (let i = 0; i < 8; i++) await Promise.resolve();
    }
    now = end;
  }
  return { idle, target, advance, calls: () => calls, allow: (value: boolean) => { allowed = value; } };
}

test("default timers do not receive the controller as their browser receiver", t => {
  const token = {} as ReturnType<typeof setTimeout>;
  const idle = new IdleCompilation(async () => {}, () => true);
  t.mock.method(globalThis, "setTimeout", function (this: unknown) {
    assert.notEqual(this, idle, "native browser timers reject a controller receiver");
    return token;
  });
  t.mock.method(globalThis, "clearTimeout", function (this: unknown, id: unknown) {
    assert.notEqual(this, idle);
    assert.equal(id, token);
  });
  idle.update({ enabled: true, projectId: "paper", key: "a", viewKey: "a", needsCompile: true, blocked: false, blockWindow: true });
  idle.activity(); idle.dispose();
});

test("block windows require four uninterrupted seconds, including scrolling that doesn't change the window", async () => {
  const f = fixture(); f.idle.update(f.target);
  await f.advance(3999); assert.equal(f.calls(), 0);
  f.idle.activity(); await f.advance(2000); f.idle.activity();
  await f.advance(3999); assert.equal(f.calls(), 0);
  await f.advance(1); assert.equal(f.calls(), 1);
  await f.advance(60000); assert.equal(f.calls(), 1, "unchanged/failed targets do not repeatedly compile");
});

test("typing, momentum and scope changes coalesce into the final window only", async () => {
  const f = fixture(); f.idle.update(f.target);
  await f.advance(3500);
  f.idle.update({ ...f.target, key: "revision-b", viewKey: "window-b" });
  await f.advance(3500); f.idle.activity();
  await f.advance(3500); assert.equal(f.calls(), 0);
  await f.advance(500); assert.equal(f.calls(), 1);
});

test("dragging and IME composition require release before the quiet countdown", async () => {
  const f = fixture(); f.idle.update(f.target);
  f.idle.hold("pointer"); f.idle.hold("composition"); await f.advance(10000);
  f.idle.release("pointer"); await f.advance(10000); assert.equal(f.calls(), 0);
  f.idle.release("composition"); await f.advance(3999); assert.equal(f.calls(), 0);
  await f.advance(1); assert.equal(f.calls(), 1);
});

test("disabled, already-current, blocked, hidden and selected work never compiles", async () => {
  for (const patch of [{ enabled: false }, { needsCompile: false }, { blocked: true }, { projectId: undefined }]) {
    const f = fixture(); f.idle.update({ ...f.target, ...patch }); await f.advance(60000); assert.equal(f.calls(), 0);
  }
  const f = fixture(); f.idle.update(f.target); f.allow(false); await f.advance(10000); assert.equal(f.calls(), 0);
  f.allow(true); f.idle.activity(); await f.advance(4000); assert.equal(f.calls(), 1);
});

test("ordinary editing has a shorter pause; disabling or changing project cancels pending work", async () => {
  const f = fixture(); f.idle.update({ ...f.target, blockWindow: false });
  await f.advance(compilePause.editing - 1); assert.equal(f.calls(), 0);
  await f.advance(1); assert.equal(f.calls(), 1);
  f.idle.update({ ...f.target, projectId: "other", key: "other-revision" });
  await f.advance(3999); f.idle.update({ ...f.target, enabled: false }); await f.advance(10000); assert.equal(f.calls(), 1);
  f.idle.update(f.target); f.idle.dispose(); await f.advance(10000); assert.equal(f.calls(), 1);
});

test("in-flight saves cannot overlap or cause retry loops after changing the source revision", async () => {
  let finish!: () => void;
  const f = fixture(() => new Promise<void>(resolve => { finish = resolve; }));
  f.idle.update(f.target); await f.advance(4000); assert.equal(f.calls(), 1);
  f.idle.update({ ...f.target, key: "saved-revision", blocked: true }); await f.advance(10000); assert.equal(f.calls(), 1);
  f.idle.update({ ...f.target, key: "saved-revision" }); finish(); await f.advance(10000);
  assert.equal(f.calls(), 1);
});

test("a new view during a running build is not mistaken for the compiled view", async () => {
  let finish!: () => void;
  const f = fixture(() => new Promise<void>(resolve => { finish = resolve; }));
  f.idle.update(f.target); await f.advance(4000);
  f.idle.update({ ...f.target, key: "b", viewKey: "window-b" }); finish(); await f.advance(1);
  await f.advance(4000); assert.equal(f.calls(), 2); f.idle.dispose(); finish();
});

test("errors are attempted once; a deliberate off/on toggle permits another attempt", async () => {
  const f = fixture(async () => { throw new Error("TeX error"); });
  f.idle.update(f.target); await f.advance(60000); assert.equal(f.calls(), 1);
  f.idle.update({ ...f.target, enabled: false }); f.idle.update(f.target); await f.advance(4000); assert.equal(f.calls(), 2);
});

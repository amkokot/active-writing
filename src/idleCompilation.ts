export interface IdleCompileTarget {
  enabled: boolean;
  projectId?: string;
  key: string;
  viewKey: string;
  needsCompile: boolean;
  blocked: boolean;
  blockWindow: boolean;
}
export const compilePause = { editing: 1500, blockWindow: 4000 };
type CompileTimer = ReturnType<typeof setTimeout>;
type ScheduleCompile = (callback: () => void, delay: number) => CompileTimer;
type CancelCompile = (timer: CompileTimer) => void;

/** One local build after a genuine pause, not one build per scrolling block.
 * The injected timer lets tests exercise momentum, holds and failures exactly. */
export class IdleCompilation {
  private target?: IdleCompileTarget;
  private timer?: ReturnType<typeof setTimeout>;
  private attempted?: string;
  private holds = new Set<string>();
  private busy = false;
  private disposed = false;
  private activityVersion = 0;
  private run: () => Promise<void>;
  private allowed: () => boolean;
  private schedule: ScheduleCompile;
  private cancel: CancelCompile;
  constructor(run: () => Promise<void>, allowed: () => boolean,
    // Browser timers must not receive this controller as their receiver.
    schedule: ScheduleCompile = (callback, delay) => setTimeout(callback, delay),
    cancel: CancelCompile = (timer) => clearTimeout(timer)) {
    this.run = run; this.allowed = allowed; this.schedule = schedule; this.cancel = cancel;
  }
  private identity(target = this.target) { return target && `${target.projectId}:${target.key}`; }
  private clear() { if (this.timer !== undefined) this.cancel(this.timer); this.timer = undefined; }
  update(target: IdleCompileTarget) {
    if (this.disposed) return;
    const previous = this.target;
    this.target = target;
    if (previous?.projectId !== target.projectId || !previous?.enabled && target.enabled) this.attempted = undefined;
    if (!previous || JSON.stringify(previous) !== JSON.stringify(target)) this.arm();
  }
  activity() { this.activityVersion++; this.arm(); }
  hold(name: string) { this.holds.add(name); this.activityVersion++; this.clear(); }
  release(name: string) { if (this.holds.delete(name)) this.activity(); }
  private eligible() {
    return !this.disposed && !this.busy && !this.holds.size && this.target?.enabled && this.target.projectId
      && this.target.needsCompile && !this.target.blocked && this.identity() !== this.attempted && this.allowed();
  }
  private arm() {
    this.clear();
    if (!this.eligible()) return;
    this.timer = this.schedule(() => { this.timer = undefined; void this.fire(); }, this.target!.blockWindow ? compilePause.blockWindow : compilePause.editing);
  }
  private async fire() {
    if (!this.eligible()) return;
    const identity = this.identity(), projectId = this.target!.projectId, viewKey = this.target!.viewKey, activity = this.activityVersion;
    this.attempted = identity; this.busy = true;
    try { await this.run(); } catch { /* The compile UI owns error reporting. No automatic retry loop. */ }
    finally {
      this.busy = false;
      // Saving source can change the revision/key during the same attempt.
      if (activity === this.activityVersion && projectId === this.target?.projectId && viewKey === this.target?.viewKey) this.attempted = this.identity();
      this.arm();
    }
  }
  dispose() { this.disposed = true; this.clear(); this.holds.clear(); }
}

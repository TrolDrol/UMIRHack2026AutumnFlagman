// Display estimates only. Commands are always validated by the backend clock.
export class ServerClock {
  private scope: string | null = null;
  private sample: { scope: string; at: number; monotonic: number } | null =
    null;
  reset() {
    this.sample = null;
    this.scope = null;
  }
  observe(scope: string, timestamp: unknown) {
    if (this.scope !== scope) { this.sample = null; this.scope = scope; }
    if (typeof timestamp !== "string") return;
    const at = Date.parse(timestamp);
    if (Number.isFinite(at))
      this.sample = { scope, at, monotonic: performance.now() };
  }
  now(scope: string): number | null {
    if (this.scope !== scope) { this.sample = null; this.scope = scope; }
    return this.sample?.scope === scope
      ? this.sample.at + Math.max(0, performance.now() - this.sample.monotonic)
      : null;
  }
}

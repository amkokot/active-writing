/** JSON snapshots for immutable, plain application data. Same wire/storage format
 * as JSON.stringify; unchanged object branches reuse their escaped JSON. Never
 * use this for in-place-mutated data, replacers or pretty-printed exports.
 * Weak keys do not keep old projects/drafts alive. */
interface Snapshotter {
  (value: object): string;
  (value: unknown): string | undefined;
}
export function createJsonSnapshotter(): Snapshotter {
  const cache = new WeakMap<object, string>(), visiting = new WeakSet<object>();
  class NativeRequired extends Error {}
  function encode(value: unknown): string | undefined {
    if (typeof value === "function" || typeof value === "bigint") throw new NativeRequired();
    if (!value || typeof value !== "object") return JSON.stringify(value);
    const hit = cache.get(value); if (hit !== undefined) return hit;
    if (visiting.has(value)) throw new TypeError("Converting circular structure to JSON");
    const prototype = Object.getPrototypeOf(value);
    // Fall back for the WHOLE root, not just a child: toJSON receives its actual
    // property key in native JSON. Accessors may also be stateful, so never cache.
    if ((!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
      || Object.values(Object.getOwnPropertyDescriptors(value)).some((descriptor) => descriptor.get || descriptor.set)
      || typeof (value as { toJSON?: unknown }).toJSON === "function") throw new NativeRequired();
    visiting.add(value);
    try {
      // Numeric/string output rows are frequent in notebooks. Let native JSON
      // handle these leaves in one pass rather than escaping each item in JS.
      if (Array.isArray(value) && value.every((item) => item === null || !["object", "function"].includes(typeof item))) {
        const result = JSON.stringify(value); cache.set(value, result); return result;
      }
      const result = Array.isArray(value)
        ? `[${Array.from({ length: value.length }, (_, i) => encode(value[i]) ?? "null").join(",")}]`
        : `{${Object.keys(value).flatMap((key) => {
          const json = encode((value as Record<string, unknown>)[key]);
          return json === undefined ? [] : [`${JSON.stringify(key)}:${json}`];
        }).join(",")}}`;
      cache.set(value, result); return result;
    } finally { visiting.delete(value); }
  }
  return ((value: unknown) => {
    try { return encode(value); }
    catch (error) { if (error instanceof NativeRequired) return JSON.stringify(value); throw error; }
  }) as Snapshotter;
}

/** Embed a trusted snapshot produced above without decoding/re-escaping the
 * whole history. Metadata still goes through native JSON escaping. */
export function snapshotRequest(metadata: Record<string, unknown>, field: string, snapshot: string) {
  const prefix = JSON.stringify(metadata);
  return `${prefix.slice(0, -1)}${prefix === "{}" ? "" : ","}${JSON.stringify(field)}:${snapshot}}`;
}

// normalize.ts — Shared value normalization for IPC-safe transport.

export function normalizeValue(value: unknown, _seen?: WeakSet<object>): unknown {
  const seen = _seen ?? new WeakSet();

  if (value === null) return null;
  if (value === undefined) return { __type: "undefined" };
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "number") {
      if (Number.isNaN(value)) return { __type: "NaN" };
      if (value === Infinity) return { __type: "Infinity" };
      if (value === -Infinity) return { __type: "-Infinity" };
    }
    return value;
  }
  if (typeof value === "bigint") return { __type: "BigInt", value: `${value}n` };
  if (typeof value === "symbol") return { __type: "Symbol", description: value.description ?? "" };
  if (typeof value === "function") return { __type: "Function", name: value.name || "anonymous" };

  if (value instanceof Error) {
    return { __type: "Error", name: value.name, message: value.message, stack: value.stack ?? "" };
  }

  if (value instanceof Date) return value.toISOString();

  if (value instanceof Map) {
    return {
      __type: "Map",
      entries: Array.from(value.entries()).map(([k, v]) => [normalizeValue(k, seen), normalizeValue(v, seen)]),
    };
  }

  if (value instanceof Set) {
    return {
      __type: "Set",
      values: Array.from(value.values()).map((v) => normalizeValue(v, seen)),
    };
  }

  if (typeof value === "object") {
    if (seen.has(value as object)) {
      // KNOWN LIMITATION (F-8): JSON.stringify will always throw for truly
      // circular structures, making the try branch effectively dead code.
      // The catch branch handles it correctly. Kept for the rare case where
      // the WeakSet triggers on a non-circular DAG (object reachable via
      // multiple paths).
      let preview = "";
      try {
        preview = JSON.stringify(value).slice(0, 200);
      } catch {
        preview = "[circular]";
      }
      return { __type: "Circular", preview };
    }
    seen.add(value as object);

    try {
      if (Array.isArray(value)) {
        const result = value.map((v) => normalizeValue(v, seen));
        seen.delete(value);
        return result;
      }

      const proto = Object.getPrototypeOf(value);
      if (proto === Object.prototype || proto === null) {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
          result[k] = normalizeValue(v, seen);
        }
        seen.delete(value);
        return result;
      }

      const className = (value as object).constructor?.name ?? "Unknown";
      const properties: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        properties[k] = normalizeValue(v, seen);
      }
      seen.delete(value);
      return { __type: "Instance", className, properties };
    } catch {
      seen.delete(value as object);
      return { __type: "Circular", preview: "[unserializable]" };
    }
  }

  return String(value);
}

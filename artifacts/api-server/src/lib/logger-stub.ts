/**
 * Minimal console logger used in the BisectHosting bundle.
 * Replaces pino to avoid worker-thread files with hardcoded absolute paths.
 */
function fmt(obj: object): string {
  return " " + JSON.stringify(obj, (_key, val) => {
    if (val instanceof Error) return { message: val.message, stack: val.stack };
    return val;
  });
}

function log(level: string, obj: object | string, msg?: string) {
  if (typeof obj === "string") {
    console.log(`[${level}]`, obj);
  } else {
    console.log(`[${level}]`, msg ?? "", fmt(obj));
  }
}

export const logger = {
  info:  (obj: object | string, msg?: string) => log("INFO", obj, msg),
  warn:  (obj: object | string, msg?: string) => log("WARN", obj, msg),
  error: (obj: object | string, msg?: string) => log("ERROR", obj, msg),
  debug: (obj: object | string, msg?: string) => log("DEBUG", obj, msg),
  child: (_bindings: object) => logger,
};

/**
 * Minimal console logger used in the BisectHosting bundle.
 * Replaces pino to avoid worker-thread files with hardcoded absolute paths.
 */
const fmt = (obj?: object) => (obj ? " " + JSON.stringify(obj) : "");

export const logger = {
  info:  (obj: object | string, msg?: string) =>
    console.log(`[INFO]`,  typeof obj === "string" ? obj : msg ?? "", typeof obj === "object" ? fmt(obj) : ""),
  warn:  (obj: object | string, msg?: string) =>
    console.warn(`[WARN]`, typeof obj === "string" ? obj : msg ?? "", typeof obj === "object" ? fmt(obj) : ""),
  error: (obj: object | string, msg?: string) =>
    console.error(`[ERROR]`, typeof obj === "string" ? obj : msg ?? "", typeof obj === "object" ? fmt(obj) : ""),
  debug: (obj: object | string, msg?: string) =>
    console.debug(`[DEBUG]`, typeof obj === "string" ? obj : msg ?? "", typeof obj === "object" ? fmt(obj) : ""),
  child: (_bindings: object) => logger,
};

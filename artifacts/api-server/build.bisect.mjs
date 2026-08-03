/**
 * Builds the standalone bot bundle into /bisect/ at the repo root.
 * This folder is committed to git so BisectHosting can clone and run it directly.
 *
 * Usage: node build.bisect.mjs
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { rm, writeFile, mkdir } from "node:fs/promises";

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const bisectDir = path.resolve(artifactDir, "../../bisect");

const external = [
  "*.node", "sharp", "better-sqlite3", "sqlite3", "canvas", "bcrypt", "argon2",
  "fsevents", "re2", "farmhash", "xxhash-addon", "bufferutil", "utf-8-validate",
  "ssh2", "cpu-features", "dtrace-provider", "isolated-vm", "lightningcss",
  "pg-native", "oracledb", "mongodb-client-encryption", "nodemailer", "handlebars",
  "knex", "typeorm", "protobufjs", "onnxruntime-node", "@tensorflow/*",
  "@prisma/client", "@mikro-orm/*", "@grpc/*", "@swc/*", "@aws-sdk/*", "@azure/*",
  "@opentelemetry/*", "@google-cloud/*", "@google/*", "googleapis", "firebase-admin",
  "@parcel/watcher", "@sentry/profiling-node", "@tree-sitter/*", "aws-sdk",
  "classic-level", "dd-trace", "ffi-napi", "grpc", "hiredis", "kerberos",
  "leveldown", "miniflare", "mysql2", "newrelic", "odbc", "piscina", "realm",
  "ref-napi", "rocksdb", "sass-embedded", "sequelize", "serialport", "snappy",
  "tinypool", "usb", "workerd", "wrangler", "zeromq", "zeromq-prebuilt",
  "playwright", "puppeteer", "puppeteer-core", "electron",
];

const banner = {
  js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
};

async function buildBisect() {
  await rm(bisectDir, { recursive: true, force: true });
  await mkdir(bisectDir, { recursive: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/bot-standalone.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: bisectDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    external,
    sourcemap: false,
    banner,
    plugins: [
      // Replace pino logger with a console stub — avoids worker-thread files
      // with hardcoded absolute paths that break on non-Replit hosts.
      {
        name: "logger-stub",
        setup(build) {
          build.onResolve({ filter: /\/lib\/logger$/ }, (args) => ({
            path: path.resolve(artifactDir, "src/lib/logger-stub.ts"),
          }));
        },
      },
    ],
  });

  // Write a minimal package.json for BisectHosting
  const pkg = {
    name: "discord-bot",
    version: "1.0.0",
    type: "module",
    scripts: {
      start: "node bot-standalone.mjs",
    },
    engines: { node: ">=20" },
  };
  await writeFile(path.join(bisectDir, "package.json"), JSON.stringify(pkg, null, 2));

  // Write a .env.example so BisectHosting users know what vars to set
  const envExample = [
    "# Set these in your BisectHosting panel under Environment Variables",
    "DISCORD_BOT_TOKEN=",
    "DISCORD_CLIENT_ID=",
    "DISCORD_GUILD_ID=",
  ].join("\n");
  await writeFile(path.join(bisectDir, ".env.example"), envExample);

  console.log(`\nBisectHosting bundle written to: ${bisectDir}`);
  console.log("Start command for BisectHosting: node bot-standalone.mjs");
}

buildBisect().catch((err) => {
  console.error(err);
  process.exit(1);
});

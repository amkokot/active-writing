import path from "node:path";
import { shareReader } from "../server/shareReader.ts";

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
if (process.argv.includes("--help")) {
  console.log("Usage: node scripts/shareReaderServer.mjs --folder PATH_TO_EXPORTED_aw --port 4180\nSet AW_SHARE_TOKEN (32 random bytes, base64url), AW_SHARE_CODE (4–12 digits), and AW_SHARE_ORIGIN (HTTPS public origin, or local HTTP for testing) outside the repository. This is a separate read-only service; it never starts or exposes the Aw editor. No automatic hosting, upload or Git push.");
} else {
  const folder = arg("--folder"), port = Number(arg("--port") ?? 4180);
  if (!folder || !Number.isInteger(port) || port < 1024 || port > 65535 || port === 4173) throw new Error("Choose an exported aw/ folder and a separate reader port (not 4173).");
  const server = await shareReader({ folder: path.resolve(folder), token: process.env.AW_SHARE_TOKEN ?? "", code: process.env.AW_SHARE_CODE ?? "", origin: process.env.AW_SHARE_ORIGIN ?? `http://127.0.0.1:${port}` });
  server.on("error", error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, "127.0.0.1", () => console.log(`Aw read-only reader listening on 127.0.0.1:${port}. Use the configured origin plus /PRIVATE_TOKEN/. Keep that link and code out of public logs.`));
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(() => process.exit(0)));
}

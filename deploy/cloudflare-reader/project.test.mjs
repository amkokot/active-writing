import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, pbkdf2Sync, createHash } from "node:crypto";
import { configuration, buildWorker, prepare } from "./project.mjs";

const source = await readFile(new URL("./reader/worker.js", import.meta.url), "utf8");
const options = { name: "aw-test", account: "a".repeat(32), subdomain: "test-account.workers.dev", database: "00000000-0000-4000-8000-000000000000" };
const map = new Map([["index.html", Buffer.from("<h1>PRIVATE</h1>")], ["overview.pdf", Buffer.from("%PDF-PRIVATE")], ["assets/image.png", randomBytes(15000)]]);
const manifest = { format: "active-writing-reader", version: 1, files: [...map].map(([name, b]) => ({ name, sha256: createHash("sha256").update(b).digest("hex") })) };
const files = new Map([...map, ["reader.json", Buffer.from(JSON.stringify(manifest))], ["reader.zip", Buffer.from("PK-private")]]);

test("new project configuration is read-only, private by gate, and shares only the named D1", () => {
  const c = configuration(options);
  assert.equal(c.assets, undefined); assert.equal(c.preview_urls, false); assert.deepEqual(c.compatibility_flags, ["nodejs_compat"]);
  assert.equal(c.d1_databases[0].database_id, options.database); assert.equal(c.origin, "https://aw-test.test-account.workers.dev");
  for (const change of [{ name: "../other" }, { account: "bad" }, { subdomain: "other.example" }, { database: "bad" }]) assert.throws(() => configuration({ ...options, ...change }));
});
test("deployment adapter refuses changed code markers and oversized payloads", () => {
  for (const altered of [source.replace("AW_READER_FILES", "OTHER"), source.replace("const unbase64", "const changedDecoder"), source.replace('const keys = ["global", `ip:${hashedIp}`];', "const keys = [];"), source + "const FILES = null; // AW_READER_FILES"]) assert.throws(() => buildWorker(altered, files));
  assert.throws(() => buildWorker(source, new Map([["big", Buffer.alloc(8_000_001)]])));
});
test("preparation never overwrites an existing deployment folder", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "aw-cloudflare-test-"));
  await writeFile(path.join(folder, "keep.txt"), "human work");
  await assert.rejects(prepare({ ...options, reader: "missing", output: folder }), /NEW absent/);
  assert.equal(await readFile(path.join(folder, "keep.txt"), "utf8"), "human work");
});
test("native-decoded deployment preserves exact hashes, code gate and cross-project budget isolation", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "aw-cloudflare-worker-"));
  const built = buildWorker(source, files), filename = path.join(folder, "worker.mjs"); await writeFile(filename, built.worker);
  const { createReader } = await import(pathToFileURL(filename).href);
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec(await readFile(new URL("./reader/schema.sql", import.meta.url), "utf8"));
  const DB = { prepare(sql) { return { bind(...args) { return { sql, args, async run() { return sqlite.prepare(sql).run(...args); } }; } }; }, async batch(items) { return items.map(({ sql, args }) => ({ results: sqlite.prepare(sql).all(...args) })); } };
  const salt = randomBytes(16), env = { AW_SHARE_ORIGIN: "https://reader.example", AW_SHARE_TOKEN: "T".repeat(43), AW_SESSION_SECRET: randomBytes(32).toString("base64url"), AW_CODE_SALT: salt.toString("base64url"), AW_CODE_HASH: pbkdf2Sync("1234", salt, 100000, 32, "sha256").toString("base64url"), DB };
  const handle = createReader(built.bundle), request = (name, opts = {}, e = env) => handle(new Request(`${e.AW_SHARE_ORIGIN}/${e.AW_SHARE_TOKEN}/${name}`, opts), e);
  const login = (code, e = env) => request("unlock", { method: "POST", headers: { Origin: e.AW_SHARE_ORIGIN, "Content-Type": "application/x-www-form-urlencoded" }, body: `code=${code}` }, e);
  try {
    for (const name of map.keys()) assert.doesNotMatch(await (await request(name)).text(), /PRIVATE/);
    const opened = await login("1234"); assert.equal(opened.status, 303); const cookie = opened.headers.get("set-cookie").split(";")[0];
    for (const [name, b] of files) { const r = await request(name, { headers: { Cookie: cookie } }); assert.equal(r.status, 200); assert.deepEqual(Buffer.from(await r.arrayBuffer()), b); }
    for (let i = 0; i < 5; i++) assert.equal((await login("9999")).status, 401);
    assert.equal((await login("9999")).status, 429);
    const other = { ...env, AW_SHARE_TOKEN: "U".repeat(43) }; assert.equal((await login("1234", other)).status, 303, "Another project must not inherit the first one's guessing budget");
    const corrupt = { ...built.bundle, "assets/image.png": Buffer.from("wrong").toString("base64") }, bad = createReader(corrupt);
    const r = await bad(new Request(`${env.AW_SHARE_ORIGIN}/${env.AW_SHARE_TOKEN}/overview.pdf`, { headers: { Cookie: cookie } }), env); assert.equal(r.status, 503);
    assert.ok(sqlite.prepare("SELECT key FROM aw_reader_attempts").all().every(row => row.key.startsWith("project:") && !row.key.includes(env.AW_SHARE_TOKEN)));
  } finally { sqlite.close(); }
});

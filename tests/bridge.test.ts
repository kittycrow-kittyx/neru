import { parseJson, record, field, numberField } from "../src/fs/wire.js";
import assert from "node:assert/strict";
import test from "node:test";
import { NeruFsBridge } from "../src/fs/bridge.js";
import { AuthoritativeFilesystem, MemoryPersistence } from "../src/fs/core.js";
import { SharedFsHttpServer } from "../src/fs/server.js";

test("NERU bridge exposes the same authority to a Linux mount client", async () => {
  const filesystem = await AuthoritativeFilesystem.open(new MemoryPersistence(), { filesystemId: "bridge" });
  const server = await new SharedFsHttpServer(filesystem).listen();
  try {
    const bridge = new NeruFsBridge({ endpoint: server.url, clientId: "linux-mount" });
    const connect = record(parseJson(await bridge.json(JSON.stringify({ schema: 1, id: "1", method: "connect" }))));
    assert.equal(connect.ok, true);
    const snapshot = record(parseJson(await bridge.json(JSON.stringify({ schema: 1, id: "2", method: "snapshot" }))));
    assert.equal(snapshot.ok, true);
    assert.equal(numberField(record(field(snapshot, "value")), "generation"), 0);
  } finally {
    await server.close();
  }
});

test("filesystem bridge rejects malformed transactions and unsupported methods", async () => {
  const filesystem = await AuthoritativeFilesystem.open(new MemoryPersistence(), { filesystemId: "invalid-wire" });
  const server = await new SharedFsHttpServer(filesystem).listen();
  try {
    const bridge = new NeruFsBridge({ endpoint: server.url });
    const invalid = { schema: 1, id: "bad", method: "commit", baseGeneration: 0, operations: [{ op: "write", path: "/etc/a", offset: "0", data: "" }] };
    const result = record(parseJson(await bridge.json(JSON.stringify(invalid))));
    assert.equal(result.ok, false);
    assert.equal(result.id, "bad");
    const unsupported = record(parseJson(await bridge.json(JSON.stringify({ schema: 1, id: "unsupported", method: "missing" }))));
    assert.equal(unsupported.ok, false);
    assert.equal(filesystem.snapshot().generation, 0);
  } finally { await server.close(); }
});

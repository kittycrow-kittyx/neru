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

import { DatabaseSync } from "node:sqlite";
import { BaseCheckpointSaver, WRITES_IDX_MAP } from "@langchain/langgraph-checkpoint";
import { sha256 } from "./files.mjs";

const coordinates = row => Object.hasOwn(row, "task") ? ["writes", row.thread, row.ns, row.id, row.task, row.idx] : ["checkpoints", row.thread, row.ns, row.id, row.parent];
const rowHash = row => sha256(Buffer.concat([Buffer.from(JSON.stringify([...coordinates(row), row.type])), Buffer.from(row.data)]));
async function encode(serde, value, coordinate) {
  const [type, bytes] = await serde.dumpsTyped(value);
  const data = Buffer.from(bytes);
  return { type, data, hash: rowHash({ ...coordinate, type, data }) };
}
async function decode(serde, row) {
  if (rowHash(row) !== row.hash) throw new Error("Checkpoint integrity failure");
  return serde.loadsTyped(row.type, row.data);
}
const configFor = (thread, ns, id) => ({ configurable: { thread_id: thread, checkpoint_ns: ns, checkpoint_id: id } });

/** Public LangGraph saver interface; caller owns the exclusive run lock and safe path. */
export class WorkkeelCheckpointSaver extends BaseCheckpointSaver {
  constructor(filename, { generation, initialize = false } = {}) {
    super();
    if (typeof generation !== "string" || !generation) throw new Error("Checkpoint generation is required");
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;");
    if (initialize) this.db.exec(`
      CREATE TABLE generation (id TEXT PRIMARY KEY, checkpoints INTEGER NOT NULL, writes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread TEXT, ns TEXT, id TEXT, parent TEXT, type TEXT, data BLOB, hash TEXT,
        PRIMARY KEY(thread, ns, id));
      CREATE TABLE IF NOT EXISTS writes (
        thread TEXT, ns TEXT, id TEXT, task TEXT, idx INTEGER, type TEXT, data BLOB, hash TEXT,
        PRIMARY KEY(thread, ns, id, task, idx));`);
    try {
      if (initialize) this.db.prepare("INSERT INTO generation VALUES (?,0,0)").run(generation);
      const identity = this.db.prepare("SELECT * FROM generation").all();
      if (identity.length !== 1 || identity[0].id !== generation) throw new Error("Checkpoint generation mismatch");
      this.assertInventory();
    } catch (error) { this.db.close(); throw error; }
  }
  assertInventory() {
    const expected = this.db.prepare("SELECT checkpoints,writes FROM generation").get();
    for (const table of ["checkpoints", "writes"]) if (this.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n !== expected[table]) throw new Error("Checkpoint inventory integrity failure");
  }
  updateInventory() {
    this.db.exec("UPDATE generation SET checkpoints=(SELECT count(*) FROM checkpoints), writes=(SELECT count(*) FROM writes)");
  }
  async getTuple(config) {
    this.assertInventory();
    const { thread_id: thread, checkpoint_ns: ns = "", checkpoint_id: id } = config.configurable ?? {};
    if (!thread) throw new Error("Checkpoint thread ID is required");
    const row = id ? this.db.prepare("SELECT * FROM checkpoints WHERE thread=? AND ns=? AND id=?").get(thread, ns, id) :
      this.db.prepare("SELECT * FROM checkpoints WHERE thread=? AND ns=? ORDER BY id DESC LIMIT 1").get(thread, ns);
    if (!row) return undefined;
    const { checkpoint, metadata } = await decode(this.serde, row);
    if (checkpoint.id !== row.id || checkpoint.v !== 4) throw new Error("Unsupported or mismatched checkpoint");
    const pendingWrites = [];
    for (const write of this.db.prepare("SELECT * FROM writes WHERE thread=? AND ns=? AND id=? ORDER BY task,idx").all(thread, ns, row.id)) {
      const [channel, value] = await decode(this.serde, write);
      pendingWrites.push([write.task, channel, value]);
    }
    return { config: configFor(thread, ns, row.id), checkpoint, metadata, pendingWrites,
      ...(row.parent ? { parentConfig: configFor(thread, ns, row.parent) } : {}) };
  }
  async *list(config, { limit = Infinity, before, filter } = {}) {
    const thread = config?.configurable?.thread_id;
    const ns = config?.configurable?.checkpoint_ns;
    const id = config?.configurable?.checkpoint_id;
    const rows = this.db.prepare("SELECT thread,ns,id FROM checkpoints ORDER BY id DESC").all();
    for (const row of rows) {
      if (limit <= 0) return;
      if (thread && row.thread !== thread || ns !== undefined && row.ns !== ns || id && row.id !== id || before?.configurable?.checkpoint_id && row.id >= before.configurable.checkpoint_id) continue;
      const tuple = await this.getTuple(configFor(row.thread, row.ns, row.id));
      if (filter && Object.entries(filter).some(([key, value]) => JSON.stringify(tuple.metadata[key]) !== JSON.stringify(value))) continue;
      yield tuple; limit--;
    }
  }
  async put(config, checkpoint, metadata) {
    const { thread_id: thread, checkpoint_ns: ns = "", checkpoint_id: parent = null } = config.configurable;
    const encoded = await encode(this.serde, { checkpoint, metadata }, { thread, ns, id: checkpoint.id, parent });
    this.assertInventory(); this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT OR REPLACE INTO checkpoints VALUES (?,?,?,?,?,?,?)").run(thread, ns, checkpoint.id, parent, encoded.type, encoded.data, encoded.hash);
      this.updateInventory(); this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return configFor(thread, ns, checkpoint.id);
  }
  async putWrites(config, writes, taskId) {
    const { thread_id: thread, checkpoint_ns: ns = "", checkpoint_id: id } = config.configurable;
    const encodedWrites = await Promise.all(writes.map(async ([channel, value], index) => {
      const idx = Object.hasOwn(WRITES_IDX_MAP, channel) ? WRITES_IDX_MAP[channel] : index;
      return { channel, idx, encoded: await encode(this.serde, [channel, value], { thread, ns, id, task: taskId, idx }) };
    }));
    this.assertInventory();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const { idx, channel, encoded } of encodedWrites) {
        const special = Object.hasOwn(WRITES_IDX_MAP, channel);
        const sql = special ? "INSERT OR REPLACE INTO writes VALUES (?,?,?,?,?,?,?,?)" : "INSERT OR IGNORE INTO writes VALUES (?,?,?,?,?,?,?,?)";
        this.db.prepare(sql).run(thread, ns, id, taskId, idx, encoded.type, encoded.data, encoded.hash);
      }
      this.updateInventory();
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  async deleteThread(threadId) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM writes WHERE thread=?").run(threadId);
      this.db.prepare("DELETE FROM checkpoints WHERE thread=?").run(threadId);
      this.updateInventory();
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  close() { this.db.close(); }
}

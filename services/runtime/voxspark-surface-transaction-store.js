"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STORE_VERSION = 1;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function createVoxSparkSurfaceTransactionStore(options = {}) {
  const rawFilePath = String(options.filePath || "").trim();
  const filePath = rawFilePath ? path.resolve(rawFilePath) : "";
  const maxBytes = Math.max(64 * 1024, Number(options.maxBytes || DEFAULT_MAX_BYTES));
  let lastReadStatus = "";
  let lastWriteStatus = "";

  function load() {
    if (!filePath) {
      lastReadStatus = "disabled";
      return null;
    }
    let raw;
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > maxBytes) {
        lastReadStatus = "invalid-size";
        return null;
      }
      raw = fs.readFileSync(filePath, "utf8");
    } catch (err) {
      lastReadStatus = err && err.code === "ENOENT" ? "missing" : "read-failed";
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== STORE_VERSION || !parsed.state || typeof parsed.state !== "object") {
        lastReadStatus = "unsupported-version";
        return null;
      }
      lastReadStatus = "ok";
      return parsed.state;
    } catch (_) {
      lastReadStatus = "invalid-json";
      return null;
    }
  }

  function save(state) {
    if (!filePath) {
      lastWriteStatus = "disabled";
      return false;
    }
    const payload = `${JSON.stringify({
      version: STORE_VERSION,
      writtenAt: Date.now(),
      state: state && typeof state === "object" ? state : {},
    }, null, 2)}\n`;
    if (Buffer.byteLength(payload, "utf8") > maxBytes) {
      lastWriteStatus = "too-large";
      return false;
    }
    const directory = path.dirname(filePath);
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporary, payload, { encoding: "utf8", mode: 0o600 });
      fs.renameSync(temporary, filePath);
      lastWriteStatus = "ok";
      return true;
    } catch (_) {
      try {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      } catch (_) {}
      lastWriteStatus = "write-failed";
      return false;
    }
  }

  function status() {
    return { enabled: Boolean(filePath), filePath, lastReadStatus, lastWriteStatus };
  }

  return { load, save, status };
}

module.exports = {
  STORE_VERSION,
  createVoxSparkSurfaceTransactionStore,
};

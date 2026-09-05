"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const STORE_VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_KEYCHAIN_SERVICE = "com.xuefusong.codex-mobile.voxspark-queue";

function decodedKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, "base64");
    return key.length === 32 ? key : null;
  } catch (_) {
    return null;
  }
}

function createVoxSparkKeychainQueueKeyProvider(options = {}) {
  const platform = options.platform || process.platform;
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const env = options.env || process.env;
  const account = String(options.account || env.USER || path.basename(options.userHome || os.homedir())).trim();
  const service = String(options.service || DEFAULT_KEYCHAIN_SERVICE).trim();
  let cached = null;

  return function queueEncryptionKey() {
    if (cached) return Buffer.from(cached);
    if (platform !== "darwin" || !account || !service) return null;
    const result = spawnSync("/usr/bin/security", [
      "find-generic-password",
      "-a", account,
      "-s", service,
      "-w",
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    });
    if (!result || result.status !== 0) return null;
    const key = decodedKey(result.stdout);
    if (!key) return null;
    cached = Buffer.from(key);
    return Buffer.from(cached);
  };
}

function createVoxSparkEncryptedQueueStore(options = {}) {
  const fileSystem = options.fs || fs;
  const cryptoImpl = options.crypto || crypto;
  const rawFilePath = String(options.filePath || "").trim();
  const filePath = rawFilePath ? path.resolve(rawFilePath) : "";
  const keyProvider = typeof options.keyProvider === "function" ? options.keyProvider : () => null;
  const maxBytes = Math.max(64 * 1024, Number(options.maxBytes || DEFAULT_MAX_BYTES));
  let lastReadStatus = "";
  let lastWriteStatus = "";

  function key() {
    try {
      const candidate = keyProvider();
      return Buffer.isBuffer(candidate) && candidate.length === 32 ? Buffer.from(candidate) : null;
    } catch (_) {
      return null;
    }
  }

  function load() {
    if (!filePath) {
      lastReadStatus = "disabled";
      return null;
    }
    const encryptionKey = key();
    if (!encryptionKey) {
      lastReadStatus = "key-unavailable";
      return null;
    }
    let raw;
    try {
      const stat = fileSystem.statSync(filePath);
      if (!stat.isFile() || stat.size > maxBytes) {
        lastReadStatus = "invalid-size";
        return null;
      }
      raw = fileSystem.readFileSync(filePath, "utf8");
    } catch (err) {
      lastReadStatus = err && err.code === "ENOENT" ? "missing" : "read-failed";
      return null;
    }
    try {
      const envelope = JSON.parse(raw);
      if (!envelope || envelope.version !== STORE_VERSION || envelope.algorithm !== ALGORITHM) {
        lastReadStatus = "unsupported-version";
        return null;
      }
      const iv = Buffer.from(String(envelope.iv || ""), "base64");
      const tag = Buffer.from(String(envelope.tag || ""), "base64");
      const ciphertext = Buffer.from(String(envelope.ciphertext || ""), "base64");
      if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) throw new Error("invalid_envelope");
      const decipher = cryptoImpl.createDecipheriv(ALGORITHM, encryptionKey, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      const parsed = JSON.parse(plaintext);
      if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.entries)) {
        lastReadStatus = "invalid-state";
        return null;
      }
      lastReadStatus = "ok";
      return parsed.entries;
    } catch (_) {
      lastReadStatus = "decrypt-failed";
      return null;
    }
  }

  function save(entries) {
    if (!filePath) {
      lastWriteStatus = "disabled";
      return false;
    }
    const encryptionKey = key();
    if (!encryptionKey) {
      lastWriteStatus = "key-unavailable";
      return false;
    }
    const plaintext = Buffer.from(JSON.stringify({
      version: STORE_VERSION,
      entries: Array.isArray(entries) ? entries : [],
    }), "utf8");
    const iv = cryptoImpl.randomBytes(12);
    const cipher = cryptoImpl.createCipheriv(ALGORITHM, encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = `${JSON.stringify({
      version: STORE_VERSION,
      algorithm: ALGORITHM,
      writtenAt: Date.now(),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    })}\n`;
    if (Buffer.byteLength(envelope, "utf8") > maxBytes) {
      lastWriteStatus = "too-large";
      return false;
    }
    const directory = path.dirname(filePath);
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fileSystem.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fileSystem.writeFileSync(temporary, envelope, { encoding: "utf8", mode: 0o600 });
      fileSystem.renameSync(temporary, filePath);
      lastWriteStatus = "ok";
      return true;
    } catch (_) {
      try {
        if (fileSystem.existsSync(temporary)) fileSystem.unlinkSync(temporary);
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
  ALGORITHM,
  DEFAULT_KEYCHAIN_SERVICE,
  STORE_VERSION,
  createVoxSparkEncryptedQueueStore,
  createVoxSparkKeychainQueueKeyProvider,
  decodedKey,
};

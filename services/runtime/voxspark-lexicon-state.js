"use strict";

function token(value, max = 128) {
  return typeof value === "string" && value.length > 0 && value.length <= max
    && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}
function term(value) {
  return typeof value === "string" && [...value].length >= 2 && [...value].length <= 64
    && !/[\p{Cc}\p{Cf}]/u.test(value) ? value : null;
}
function revision(value) { return Number.isSafeInteger(value) && value >= 0; }

// This dedicated response is returned only to the requesting authenticated settings page.
// It never becomes part of voice snapshots, diagnostics or the transaction ledger.
function normalizeLexiconDocument(value) {
  if (!value || value.schema !== 1 || !revision(value.revision)
    || !Array.isArray(value.entries) || value.entries.length > 512) return null;
  const entries = [], seen = new Set();
  for (const item of value.entries) {
    if (!item || !term(item.text) || typeof item.enabled !== "boolean" || item.source !== "manual"
      || !revision(item.updatedAt) || !Array.isArray(item.aliases) || item.aliases.length > 8
      || item.aliases.some(alias => !term(alias))) return null;
    const key = item.text.toLocaleLowerCase("en-US");
    if (seen.has(key)) return null;
    seen.add(key);
    entries.push({ text: item.text, enabled: item.enabled, source: "manual", updatedAt: item.updatedAt,
      aliases: [...item.aliases] });
  }
  return { schema: 1, revision: value.revision, entries };
}

function normalizeLexiconRequest(input) {
  if (!input || !["list", "add", "enable", "disable", "remove", "unalias"].includes(input.action)) return null;
  const request = { action: input.action };
  if (input.action === "list") return request;
  if (!token(input.request_id) || !token(input.bridge_epoch, 64) || !revision(input.expected_revision) || !term(input.text)) return null;
  Object.assign(request, { request_id: input.request_id, bridge_epoch: input.bridge_epoch,
    expected_revision: input.expected_revision, text: input.text });
  if (input.action === "add") {
    const aliases = input.aliases ?? [];
    if (!Array.isArray(aliases) || aliases.length > 8 || aliases.some(alias => !term(alias))) return null;
    request.aliases = [...aliases];
  }
  if (input.action === "unalias") {
    if (!term(input.alias)) return null;
    request.alias = input.alias;
  }
  return request;
}

module.exports = { normalizeLexiconDocument, normalizeLexiconRequest, token };

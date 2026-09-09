(function (root) {
"use strict";

const LEXICON_ERRORS = Object.freeze({
  lexicon_invalid_request: "词条格式或请求参数有误，请检查后重试。",
  lexicon_request_conflict: "该操作编号已被使用，请刷新词库后重新操作。",
  lexicon_unavailable: "当前 Bridge 尚未启用个人词库。",
  lexicon_disconnected: "暂时无法连接词库，请恢复连接后刷新。",
  lexicon_locked: "词库正在被其他操作修改，请稍后刷新再试。",
  lexicon_revision_conflict: "词库已在别处修改，已重新读取；请核对后再操作。",
  lexicon_stale_epoch: "Bridge 已重新启动，请刷新词库后再操作。",
  lexicon_invalid_term: "词条和错写需为 2–64 个字符，不能是纯数字或包含控制字符。",
  lexicon_invalid_alias: "错写不能与正确词条相同。",
  lexicon_alias_conflict: "这个错写与其他已启用词条冲突，请检查后修改。",
  lexicon_duplicate_term: "词条名称重复，请检查现有词条。",
  lexicon_term_not_found: "词条已不存在，请刷新列表。",
  lexicon_capacity: "词库已达到容量上限，请整理现有词条。",
  lexicon_invalid_file: "词库文件格式有误，未覆盖原文件，请联系维护者检查。",
  lexicon_read_failed: "读取词库失败，未使用空列表替代原文件。",
  lexicon_outcome_unknown: "保存结果未确认，已重新读取词库，请核对列表后再操作。",
  lexicon_busy: "另一项词库操作仍在进行，请稍后再试。",
});

function createVoxSparkLexiconRuntime(deps = {}) {
  const document = deps.document;
  const $ = deps.$ || (id => document.getElementById(id));
  const request = deps.request;
  const dialog = $("voxsparkLexiconDialog");
  if (!dialog || typeof request !== "function") return null;
  let snapshot = null, bridgeEpoch = "", busy = false, generation = 0, loadSequence = 0;
  let removeTarget = "", requestSequence = 0, initialized = false;
  const requestPrefix = deps.requestPrefix || (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function notice(text, error = false) {
    const status = $("voxsparkLexiconStatus"); status.textContent = text; status.dataset.error = String(error);
  }
  function setBusy(value) {
    busy = value;
    $("voxsparkLexiconRefresh").disabled = value;
    $("voxsparkLexiconSave").disabled = value || !snapshot;
    for (const button of $("voxsparkLexiconItems").querySelectorAll("button")) button.disabled = value || !snapshot;
    $("voxsparkLexiconItems").setAttribute("aria-busy", String(value));
  }
  function errorText(code) { return LEXICON_ERRORS[code] || "操作未完成，请刷新词库后重试。"; }
  function button(label, action, className) {
    const element = node("button", label, className); element.type = "button";
    element.addEventListener("click", action); return element;
  }
  function render() {
    const list = $("voxsparkLexiconItems"); list.replaceChildren();
    const entries = snapshot?.entries || [];
    const query = $("voxsparkLexiconSearch").value.trim().toLocaleLowerCase();
    const filtered = entries.filter(item => [item.text, ...item.aliases].some(value => value.toLocaleLowerCase().includes(query)));
    $("voxsparkLexiconCount").textContent = snapshot
      ? `${entries.length} 个词条 · ${entries.filter(item => item.enabled).length} 个启用${query ? ` · 找到 ${filtered.length} 个` : ""}` : "";
    $("voxsparkLexiconEmpty").hidden = !snapshot || filtered.length > 0;
    $("voxsparkLexiconEmpty").textContent = query ? "没有匹配的词条。" : "词库还是空的，可以添加第一个词条。";
    for (const item of filtered.sort((a, b) => b.updatedAt - a.updatedAt || a.text.localeCompare(b.text))) {
      const row = node("li", null, "voxspark-lexicon-item"); row.dataset.term = item.text;
      const header = node("div", null, "voxspark-lexicon-item-heading");
      header.appendChild(node("strong", item.text));
      header.appendChild(node("span", item.enabled ? "已启用" : "已停用", "voxspark-lexicon-badge"));
      row.appendChild(header);
      if (item.aliases.length) {
        const aliases = node("ul", null, "voxspark-lexicon-aliases");
        for (const alias of item.aliases) {
          const chip = node("li"); chip.appendChild(node("span", `${alias} → ${item.text}`));
          const remove = button("移除", () => mutate("unalias", { text: item.text, alias }));
          remove.setAttribute("aria-label", `移除 ${item.text} 的错写 ${alias}`); chip.appendChild(remove); aliases.appendChild(chip);
        }
        row.appendChild(aliases);
      }
      const actions = node("div", null, "voxspark-lexicon-actions");
      actions.appendChild(button(item.enabled ? "停用" : "启用", () => mutate(item.enabled ? "disable" : "enable", { text: item.text })));
      actions.appendChild(button("补充错写", () => {
        $("voxsparkLexiconTerm").value = item.text; $("voxsparkLexiconAlias").value = "";
        $("voxsparkLexiconAlias").focus();
      }));
      if (removeTarget === item.text) {
        actions.appendChild(node("span", "删除此词条及其错写？"));
        actions.appendChild(button("确认删除", () => mutate("remove", { text: item.text }), "voxspark-lexicon-danger"));
        actions.appendChild(button("取消", () => { removeTarget = ""; render(); }));
      } else actions.appendChild(button("删除", () => { removeTarget = item.text; render(); }));
      row.appendChild(actions); list.appendChild(row);
    }
    setBusy(busy);
  }
  async function load(preserveNotice = "") {
    const currentGeneration = generation, sequence = ++loadSequence;
    setBusy(true); if (!preserveNotice) notice("正在读取词库…");
    try {
      const result = await request("list", {});
      if (!dialog.open || currentGeneration !== generation || sequence !== loadSequence) return false;
      if (!result?.ok || !result.document || !Array.isArray(result.document.entries)) throw { code: result?.code };
      snapshot = result.document; bridgeEpoch = result.bridge_epoch; removeTarget = "";
      notice(preserveNotice || "词库已读取。修改从下一次录音生效，失败重试仍使用原词库。", Boolean(preserveNotice));
      return true;
    } catch (error) {
      if (dialog.open && currentGeneration === generation && sequence === loadSequence) {
        snapshot = null; bridgeEpoch = ""; notice(errorText(error?.code), true);
      }
      return false;
    } finally {
      if (dialog.open && currentGeneration === generation && sequence === loadSequence) { setBusy(false); render(); }
    }
  }
  async function mutate(action, fields) {
    if (busy || !snapshot || !bridgeEpoch || !dialog.open) return false;
    const currentGeneration = generation;
    ++loadSequence; setBusy(true); notice("正在保存…");
    const payload = { ...fields, request_id: `lexicon:${requestPrefix}:${++requestSequence}`,
      bridge_epoch: bridgeEpoch, expected_revision: snapshot.revision };
    try {
      const result = await request(action, payload);
      if (!dialog.open || currentGeneration !== generation) return false;
      if (!result?.ok) {
        const message = errorText(result?.code);
        if (["lexicon_revision_conflict", "lexicon_stale_epoch", "lexicon_outcome_unknown", "lexicon_term_not_found"].includes(result?.code)) {
          await load(message);
        } else notice(message, true);
        return false;
      }
      snapshot = result.document; bridgeEpoch = result.bridge_epoch; removeTarget = "";
      if (action === "add" && $("voxsparkLexiconTerm").value.trim() === fields.text
        && $("voxsparkLexiconAlias").value.trim() === (fields.aliases?.[0] || "")) {
        $("voxsparkLexiconTerm").value = ""; $("voxsparkLexiconAlias").value = "";
      }
      notice("已保存，下次录音生效。"); return true;
    } catch (_) {
      if (dialog.open && currentGeneration === generation) await load(errorText("lexicon_outcome_unknown"));
      return false;
    } finally {
      if (dialog.open && currentGeneration === generation) { setBusy(false); render(); }
    }
  }
  function open() {
    if (dialog.open) return;
    generation++; snapshot = null; bridgeEpoch = ""; removeTarget = "";
    dialog.showModal(); render(); void load();
  }
  function close() { generation++; ++loadSequence; dialog.close(); }
  function initialize() {
    if (initialized) return; initialized = true;
    $("voxsparkLexiconOpen").addEventListener("click", open);
    $("voxsparkLexiconClose").addEventListener("click", close);
    $("voxsparkLexiconRefresh").addEventListener("click", () => { if (!busy) void load(); });
    $("voxsparkLexiconSearch").addEventListener("input", render);
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    $("voxsparkLexiconForm").addEventListener("submit", event => {
      event.preventDefault();
      const text = $("voxsparkLexiconTerm").value.trim(), alias = $("voxsparkLexiconAlias").value.trim();
      if ([text, ...(alias ? [alias] : [])].some(value => [...value].length < 2 || [...value].length > 64)) {
        notice(errorText("lexicon_invalid_term"), true); return;
      }
      void mutate("add", { text, aliases: alias ? [alias] : [] });
    });
    setBusy(false);
  }
  return { initialize, open, close };
}


root.CodexVoxSparkLexiconRuntime = { createVoxSparkLexiconRuntime };
})(typeof globalThis !== "undefined" ? globalThis : window);

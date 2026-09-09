"use strict";

function createVoxSparkSurfaceHostRouteService(dependencies = {}) {
  const service = dependencies.service;

  function queueStatus(result) {
    if (result && result.ok) return 200;
    if (result && ["queue_store_unavailable", "queue_receipt_unavailable"].includes(result.code)) return 503;
    if (result && result.code === "queue_not_found") return 404;
    if (result && /^invalid_/.test(result.code || "")) return 400;
    return 409;
  }

  async function handleRoute({ url, method, readBody, sendJson }) {
    if (url.pathname === "/api/voxspark/lexicon" && ["GET", "POST"].includes(method)) {
      const input = method === "GET" ? { action: "list" } : await readBody();
      const result = await service.manageLexicon(input);
      const status = result.ok ? 200 : /invalid/.test(result.code || "") ? 400
        : ["lexicon_unavailable", "lexicon_disconnected"].includes(result.code) ? 503 : 409;
      sendJson(status, result);
      return { handled: true, status, body: result };
    }
    if (url.pathname === "/api/voxspark/surface/status" && method === "GET") {
      const body = service.status();
      sendJson(200, body);
      return { handled: true, status: 200, body };
    }
    if (url.pathname === "/api/voxspark/surface/context" && method === "POST") {
      const result = service.publish(await readBody());
      const status = result.ok ? 200 : 400;
      sendJson(status, result);
      return { handled: true, status, body: result };
    }
    const captureMatch = url.pathname.match(/^\/api\/voxspark\/surface\/capture\/(retry|discard)$/);
    if (captureMatch && method === "POST") {
      const result = await service.recoverCapture({ ...await readBody(), action: captureMatch[1] });
      const status = result.ok ? 200 : /^invalid_/.test(result.code || "") ? 400 : 409;
      sendJson(status, result);
      return { handled: true, status, body: result };
    }
    const queueMatch = url.pathname.match(/^\/api\/voxspark\/surface\/queue\/(enqueue|claim|complete|cancel|snapshot|inspect|retry|reconcile)$/);
    if (queueMatch && method === "POST") {
      const operation = queueMatch[1];
      const handler = {
        enqueue: "enqueueQueue",
        claim: "claimQueue",
        complete: "completeQueue",
        cancel: "cancelQueue",
        snapshot: "queueSnapshot",
        inspect: "inspectQueue",
        retry: "retryQueue",
        reconcile: "reconcileQueue",
      }[operation];
      const result = service[handler](await readBody());
      const status = queueStatus(result);
      sendJson(status, result);
      return { handled: true, status, body: result };
    }
    return { handled: false };
  }

  return { handleRoute };
}

module.exports = { createVoxSparkSurfaceHostRouteService };

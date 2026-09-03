"use strict";

function createVoxSparkSurfaceHostRouteService(dependencies = {}) {
  const service = dependencies.service;

  async function handleRoute({ url, method, readBody, sendJson }) {
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
    return { handled: false };
  }

  return { handleRoute };
}

module.exports = { createVoxSparkSurfaceHostRouteService };

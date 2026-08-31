"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const canonicalRepository = "franksong2702/codex-mobile-web-public";

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("fork governance keeps the canonical product repository explicit", () => {
  const packageJson = JSON.parse(read("package.json"));
  const readme = read("README.md");
  const governance = read("docs/FORK_GOVERNANCE.md");

  assert.equal(packageJson.repository.url, `https://github.com/${canonicalRepository}.git`);
  assert.equal(packageJson.homepage, `https://github.com/${canonicalRepository}`);
  assert.match(readme, new RegExp(`git clone https://github\\.com/${canonicalRepository}\\.git`));
  assert.match(governance, new RegExp(`Canonical repository: .*${canonicalRepository}`));
  assert.match(governance, /origin\s+-> franksong2702\/codex-mobile-web-public/);
  assert.match(governance, /upstream\s+-> pentiumxp\/codex-mobile-web-public/);
});

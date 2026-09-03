//#region \0virtual:codex-mobile-shell-entry-group/app-entry
var codexMobileViteEntryGroup = {
	"id": "app-entry",
	"phase": "startup-critical",
	"startupCritical": true,
	"chunkTarget": "startup-app-shell",
	"assets": [
		"/runtime-wiring-runtime.js",
		"/app-shell-runtime.js",
		"/app.js"
	],
	"assetCount": 3,
	"classicAssetRecords": [
		{
			"path": "/runtime-wiring-runtime.js",
			"sourcePath": "public/runtime-wiring-runtime.js",
			"bytes": 12169,
			"sha256": "1edc280ac96b17f6e3ed7d194d85ac9cd49bb07b3fc453678520a40c4d96f686"
		},
		{
			"path": "/app-shell-runtime.js",
			"sourcePath": "public/app-shell-runtime.js",
			"bytes": 52186,
			"sha256": "5ae7ecb3555e01fe18e4240f636562e71a6a6bffa97e4053827f2068dd5d9f64"
		},
		{
			"path": "/app.js",
			"sourcePath": "public/app.js",
			"bytes": 1479,
			"sha256": "87cc1d060a52300818f5e0ae69cf724ee2a5f44e6adb689d4d9b9884aa59bc20"
		}
	],
	"classicAssetHashCount": 3,
	"classicAssetBytes": 65834,
	"classicGlobalExports": [
		{
			"asset": "/runtime-wiring-runtime.js",
			"globals": ["CodexRuntimeWiringRuntime"]
		},
		{
			"asset": "/app-shell-runtime.js",
			"globals": ["CodexAppShellRuntime"]
		},
		{
			"asset": "/app.js",
			"globals": ["CodexMobileAppEntry"]
		}
	],
	"classicGlobalExportAssetCount": 3,
	"classicGlobalExportCount": 3,
	"startupGlobalContracts": [{
		"name": "CodexAppShellRuntime",
		"asset": "/app-shell-runtime.js",
		"groupId": "app-entry",
		"startupCritical": true,
		"source": "startup-window-guard",
		"present": true
	}, {
		"name": "CodexRuntimeWiringRuntime",
		"asset": "/runtime-wiring-runtime.js",
		"groupId": "app-entry",
		"startupCritical": true,
		"source": "startup-window-guard",
		"present": true
	}],
	"shellCacheName": "codex-mobile-shell-v625-87cf361d3d3f",
	"clientBuildId": "0.1.11|codex-mobile-shell-v625-87cf361d3d3f"
};
var codexMobileViteEntryGroupRegistry = globalThis.__CODEX_MOBILE_VITE_ENTRY_GROUP_CHUNKS__ || {};
codexMobileViteEntryGroupRegistry[codexMobileViteEntryGroup.id] = codexMobileViteEntryGroup;
globalThis.__CODEX_MOBILE_VITE_ENTRY_GROUP_CHUNKS__ = codexMobileViteEntryGroupRegistry;
//#endregion
export { codexMobileViteEntryGroup, codexMobileViteEntryGroup as default };

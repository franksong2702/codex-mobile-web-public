# 独立主线整合候选 — 2026-09-07

## 来源与范围

候选分支：`integration/independent-main-20260907`。
父提交：VoxSpark R3 `b61c9f42cd1875ec61e689bd4ed3cb6c7a980127` 与独立 fork 治理 `9c922477b56e9546e82b6e00e351cfb6abe029e9`。

在两条历史之上保留现有运行目录的源码改动：VoxSpark Composer 选区与动作队列、工作区可见性、权限协议兼容、线程列表、macOS shared launcher 与预热修复。84 个源码/文档/测试文件做了逐文件快照和 SHA-256 记录。相对快照，仅四个文件经过治理三方合并：`docs/README.md`、`package.json`、`services/runtime/server-runtime-config-service.js`、`test/server-runtime-config-service.test.js`。其余快照文件保持逐字节一致。未复制运行目录的私有交接记录、运行数据或过往未跟踪的生成资源；前端资源由候选源码重新构建。

## 验证

- `npm ci --ignore-scripts --no-audit --no-fund`：exit 0。
- `npm run --silent build:frontend`：exit 0。
- `npm test`：exit 0；2746 项，2744 通过，2 项浏览器测试默认跳过。
- 配置 `CHROMIUM_EXECUTABLE` 后执行 `node --test test/voxspark-composer-selection.browser.test.js`：exit 0；2/2 通过，验证 classic/native-esm 真实 DOM 插入及光标位置。
- `npm run --silent check`、`npm run --silent check:macos`、`npm run --silent check:voxspark`、`npm run --silent check:frontend-manifest`：均 exit 0。
- 快照回读：84 个文件，无运行目录漂移；候选差异仅上述四个治理合并文件。
- 构建标识：`0.1.11|codex-mobile-shell-v625-3e33525dd6c4`。

本轮没有生产部署、服务重启、对外推送或 BOX 硬件验收。现有测试通过不等于线上完整验收。

## 上线前仍需处理

1. 自有远端 `main` 当前为 `9c922477`；候选保留该提交祖先关系，可审查后快进发布。推送前需检查远端没有新的提交，并审查拟发布差异中的私有材料。
2. 运行目录仍为旧 `main` 加本地改动。不要对其执行 reset、checkout 或直接 pull。先保留完整恢复材料，再用明确文件清单部署候选，并区分静态文件立即生效与后台代码需要 listener 重启。
3. Git remote 配置由所有 worktree 共用。不能在候选中重命名 remote 并误认为只影响候选。运行目录当前 `origin` 指向原作者，`fork` 指向自有仓库；改为治理规定的 `origin=自有仓库 / upstream=原作者` 前应同时核对其他 worktree 的跟踪关系及运行时更新入口。
4. macOS launcher 仍有本机默认安装路径；它来自已有实现，本次完整保留。公开发布审查时需决定是否参数化，不应误称为通用安装验收。
5. 生产切换后需验证 API、前端启动、Host 连接和实际 BOX 动作；历史部署交接中的未完成验收不能由本轮单元测试替代。

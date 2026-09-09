# VoxSpark 当前基线

更新：2026-09-09。本文件描述已实现的源码能力及当天已验证的部署范围；Git 提交、安装文件树和设备固件身份分别记录，不能互相替代。

## 当前能力与责任

- Mobile 后台持有 Bridge Host 连接、目标租约、动作账本和加密 Queue；浏览器提供当前 Session、Composer 和原有 Codex 操作。
- 语音状态栏显示 BOX 可用性、录音、识别、润色及原 Session 归属。最终文本才进入 Composer，跨 Session 不串写。
- C1 提供队列正文、取消、明确失败后的重试、未知结果核对及转为引导。旧队列请求完成不会清除后来输入的新草稿；结果未知时不盲目重发。
- C2 提供失败录音的重试识别与丢弃。录音由 Bridge 在内存保留，首次失败后最多15分钟；Bridge 重启不保证恢复音频。
- C3 在设置 → VoxSpark → 个人词库提供添加、搜索、启停、错写管理与确认删除。词库归 Bridge 持久存储；版本冲突和未知保存结果先重新读取。修改从下一次录音生效，失败重试沿用原快照。
- Bridge Host 交接修复保证旧连接处于 CLOSING 时，新连接接替前完成旧 owner 离线转换，忽略旧 socket 的迟到消息；OPEN Host 互斥不变。

详见 [Host 契约](VOXSPARK_SURFACE_HOST.md)。VoxSpark Bridge 负责语音与词库，BOX firmware 负责触控、录音和状态显示，三者保持独立仓库。

## 当前部署与验收

当天已部署 C1、C2、C3 及 Bridge Host 交接修复。用户已确认连续消息、新草稿保护、个人词库识别与 Composer 填入正常。词库单次成功不等于长期准确率或别名纠错的全面验收。

隔离自动验证覆盖浏览器 reload、Host 重连、跨 Session 归属、Mobile/Bridge 重启后的加密 Queue 恢复与单次提交。模拟 provider 和发送出口不等于真实 Codex/BOX 端到端。

仍待实际使用验收：实体自然失败后的重试/丢弃、手机睡眠及网络切换。设备当前固件身份与可刷写构建未在本次整理中核验。

## 版本与数据边界

本分支把已验证候选收拢到自有 GitHub 主线之上的独立提交。运行目录仍有历史 HEAD 与未提交修改；提交同步不代表运行目录迁移、main 合并或重新部署。安装文件哈希和部署记录保留在本机交付材料中，公开仓库不包含录音、转写、真实词库、凭据或运行数据库。

M15 试点使用 Qwen 流式 ASR3；录音≤20秒且原始识别文本≤100字符时直接出稿，否则使用 Luna low / ASR v5。自动学习与浏览器旧纠正 Map 向个人词库的持久同步未接入。完整上下文共享仍需 exact `bounded-context-v1` 配置，不因词库 UI 开启。

## 复现检查

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run build:frontend
CHROMIUM_EXECUTABLE=/absolute/path/to/chromium npm test
npm run check
npm run check:macos
npm run check:voxspark
npm run check:frontend-manifest
CHROMIUM_EXECUTABLE=/absolute/path/to/chromium node --test scripts/validate-voxspark-page-reload.cjs
```

跨仓库恢复检查位于 [Bridge](https://github.com/franksong2702/voxspark) 的 `scripts/validate-host-recovery.cjs`。部署需按精确目标另行执行；构建和测试不会自动切换服务。

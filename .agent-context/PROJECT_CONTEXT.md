# 项目上下文

更新：2026-09-09。先读本文件、HANDOFF.md 和当前基线 `../docs/VOXSPARK_BASELINE.md`。

这是独立产品仓库。Mobile 负责 Session、Composer、Queue 与 Codex；VoxSpark Bridge 负责语音、词库及恢复；firmware 负责设备行为。当前源文件和精确环境的运行检查优先于历史记录。

本分支收拢已部署的 C1/C2/C3 与 Host 交接恢复；推送源码不等于 main 合并、重新部署或运行目录迁移。不要覆盖用户已有修改，不提交凭据、录音、转写、真实词库或运行状态。

仓库中的历史中央插件路径不证明该工作区存在；适用性和入口需要按实际环境核对，不得据此声称路由 preflight 已通过。

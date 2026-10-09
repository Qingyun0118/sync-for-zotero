# Qingyun 维护版

本仓库基于 Yile Wang 的 Sync for Zotero，保留原许可证与署名。
配套 Zotero 插件：<https://github.com/Qingyun0118/llm-for-zotero>。

## 安装

下载本仓库版本 Release 的 `extension.zip`，解压并将 `extension/` 内容
更新到浏览器一直使用的解压加载目录，在扩展管理页重新加载，再刷新网页。
也可直接以本仓库的 `extension/` 为固定加载目录。解压加载的浏览器扩展
不会自动读取 GitHub Releases，需要手动更新目录并重新加载。

## 手动合并上游与发布

`origin` 指向 Qingyun0118/sync-for-zotero，`upstream` 指向
yilewang/sync-for-zotero。工作区干净后，在新分支中执行 `git fetch upstream`
和 `git merge upstream/main`。保留标题同步、两套 ChatGPT 消息结构识别和
渲染修复，更新 `extension/manifest.json` 版本，版本必须大于已发布维护版
与合并的上游版本，并更新 `RELEASE_NOTES.md`。

执行 `npm ci`、`npm test` 和 `git diff --check`。合入 main 并推送 origin，
再创建并推送与 manifest 版本一致的 `v版本号` 标签。标签工作流通过测试、
版本检查和 ZIP 校验后发布扩展。只向 origin 推送。

原发布 CLI 的 workflow_dispatch 路径仍可用于已有 draft release。

本仓库也支持将版本文件或 `RELEASE_NOTES.md` 的变更推送到 main 后发布：
工作流通过检查后创建当前版本 Release。每次发布都必须递增版本；已存在
相同版本 Release 时流程会停止，避免覆盖已发布安装包。标签发布入口仍保留。

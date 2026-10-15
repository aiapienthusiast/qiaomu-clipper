## 中文

### 新增与修复
- 修复 B 站学习页点击画面意外打开原站，现在可点击播放／暂停；保留原生控件，提供明确的原网页高清入口并保留分 P。感谢 @shyboy 提交 #81。
- 修复 Star History 等 SVG 图表无法在 AI 对话中读取的问题，转换为实际图片随问题发送。
- 修复本机模型失败后无法切换云端的问题；重试时可重新选择模型，切换选择不会自动上传音频。
- 修复笔记库看似选中却未保存、已安装助手因笔记库路径失效而误报未连接的问题。
- 助手 1.16.4 修复签名 Python 加载 MLX 失败；模型安装和识别前检查实际运行环境，错误保留关键原因。

### 验证与未验证
- 1,299 项前端测试、212 项助手测试、TypeScript、九语言及商店下载检查通过。
- 已用签名 Python 完成 Qwen3-ASR 离线识别，并验证实际 SVG 转图片及图片请求格式。固定测试入口已重载并验证助手连接。
- 用户另一台 M5、Intel、真实云端识别和 DeepSeek 实际图像回复尚未验证。B 站已具备作者的真实播放器预览证据与本机回归测试，最终整包的真实 B 站播放仍需现场验收。
- B 站官方外嵌画质仍受平台限制；Chrome 商店版不提供 YouTube 媒体文件下载。GitHub 发布不代表商店已更新。

### 升级
更新扩展后刷新原网页并重新打开阅读／学习页。本机模型用户请同时下载安装助手 1.16.4，扩展更新不会自动升级助手；已下载模型可保留。GitHub 独立安装选择 chrome-local.zip，chrome-store.zip 用于商店提交。

## English

### Added and fixed
- Keep Bilibili picture clicks inside the study player for play/pause. Preserve native controls and provide an explicit original-page HD link with the selected part. Thanks to @shyboy for #81.
- Read SVG charts, including Star History, by converting them into actual image attachments for AI chat.
- Let users choose a different model after local recognition fails. Selecting a cloud service does not start an upload automatically.
- Save vault selections reliably and keep an installed helper connected when its configured vault path becomes invalid.
- Helper 1.16.4 fixes MLX loading under the signed Python runtime, checks the actual recognition environment and preserves useful error details.

### Verification and limits
- 1,299 frontend tests, 212 helper tests, TypeScript, nine-language checks and store-download checks pass.
- Real signed Python completes offline Qwen3-ASR recognition. Actual SVG-to-image conversion and image request formatting pass. The fixed Chrome test extension was reloaded and its helper connection checked.
- Another user's M5, Intel hardware, live cloud recognition and an actual DeepSeek image response remain unverified. Bilibili has the contributor's live-player preview evidence and local regression coverage; live playback of the final packaged build still needs acceptance.
- Bilibili's official embed quality remains restricted by the platform. The Chrome Store edition does not download YouTube media. This GitHub release does not update the store listing.

### Upgrade
Refresh source pages and reopen the reader or study page after updating. Local-model users should also install helper 1.16.4; extension updates do not update the helper automatically. Existing downloaded models can be kept. Use chrome-local.zip for standalone installation and chrome-store.zip for store submission.

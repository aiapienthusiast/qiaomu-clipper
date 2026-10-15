# 本机模型、失败恢复与图片读取修复（2026-10-15）

候选扩展 1.18.5；助手 1.16.4。基线为 origin/main 0613b5c，包含固定测试入口此前的 bd691c4 和全部功能清单。主目录的其他未提交改动未动。

## 根因和修复

- 安装包 Python 3.12 启用 hardened runtime，但没有 disable-library-validation entitlement。用已安装 `/Library/QiaomuClipper/runtime-arm64/bin/python3` 新建独立 venv、pip 安装 mlx-qwen3-asr 后，import mlx.core 复现 `dlopen ... mapping process and mapped file ... have different Team IDs`。Homebrew Python 3.14 的现有模型环境不能证明安装包可用。
- 在隔离运行时副本上用 Developer ID 重签 Python，只增加原生扩展加载 entitlement，保留 hardened runtime。原来同一套 MLX/Qwen3 wheel 随即可导入、完成 Metal 运算。使用已缓存 Qwen3-ASR 0.6B 对系统合成的英文样本离线识别，结果为 `This is a local speech recognition test. The model runs on this computer.`。
- 签名构建在打包前用包内实际解释器建立独立 venv、安装真实识别 wheel、导入推理接口和执行 Metal 运算；任一失败中止打包。架构取目标解释器，避免 Rosetta 下用错测试。
- 模型安装在下载权重和报告成功前检查真实加载；识别前也检查托管解释器。错误保留尾部关键原因，避免长用户路径占满原先 200 字上限。云端路径不运行本机模型检查。
- 失败后重试先打开模型选择，忽略曾记住的自动开始；失败区域保留「换模型生成文字稿」。切换选择只改配置，用户确认后才开始新识别，重生成失败后重试仍保留已有字幕。
- 未选择笔记库时使用禁用的空占位项，避免下拉框看似选中实际没触发 change，尤其只有「选择其他文件夹」一项时。助手目标失效只报告笔记库错误，保持连接与切换入口；重查会同步真实已配置库，保存失败保留旧选择。
- Star History 图表实际为 `image/svg+xml`，旧图片读取器拒绝 SVG，错误发生在模型请求前。新流程清理脚本、外部引用、嵌入图片和动画，限制大小，将 SVG 作为隔离图片解码并转 JPEG；模型只收到 raster 图片。

## 验收边界

- 前后版本都在同一机器真实执行签名 Python 和 MLX，修复后完成离线语音识别；没有改写当前用户安装的助手或模型。
- SVG 验证使用 GitHub jackwener/opencli README 当前显示的实际 Star History 图：HTTP 200、SVG 68,031 字节；真实 Chromium 页面显示转换后的图，图片读取 1/1，协议验证通过，含 image_url JPEG 数据。
- 共用生成面板在 Chromium 模拟页实点失败后的换模型、切云端、确认；云端服务为测试桩，不实际上传或计费。窄栏按钮计算样式正常。
- 自动测试与浏览器模拟页不等于专用 Chrome 资料中重载后的端到端验收；用户机器、Intel、真实云端识别、DeepSeek 实际图像回复、安装器完成页分别待验。
- 本地候选包、GitHub 发布和商店上架是独立状态；未授权发布前不称已上线。

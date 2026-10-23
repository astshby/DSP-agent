# DSP 实验台

数字信号处理课程项目，当前 **v0.9 / 第 9 次提交 / 第 13 周**。第 1—9 次均有独立离线网页和周报；第 6 次按计划完成第二章代表性实验。OpenAI、DeepSeek 的真实模型接入安排在第 10、11 次。

## 最快开始：下载后双击

1. 在 GitHub 点击 **Code → Download ZIP** 并解压，或更新本地仓库。
2. 双击 **[self/第十三周/index.html](self/第十三周/index.html)**，使用 Chrome、Edge 或 Firefox。
3. 展开左侧“FIR / Butterworth IIR 设计”，点击 **载入双频低通实验**，查看波形、频谱和延迟说明。
4. 在右侧规则助手输入 `低通 100 Hz 然后分析频谱`，先预览，再执行。注意操作是追加的；尝试另一滤波器前可先“清空处理步骤”。

单文件可以单独复制提交，断网可用，无需安装依赖、启动服务器或填写 API Key。GitHub 显示 HTML 源代码时，请先下载，不要把源码预览当成运行页面。根目录 `index.html` 是当前开发入口，需保留旁边的 `styles.css` 和 `src/`。

## 各次交付

| 次数 | 课程周次 | 新增内容 | 周报 / 运行方法 |
|---|---|---|---|
| 1 | 第 5 周 | 发生器、手动输入、时域与统计 | [第五周](self/第五周/README.md) |
| 2 | 第 6 周 | CSV、反折/移位、采样混叠 | [第六周](self/第六周/README.md) |
| 3 | 第 7 周 | 线性卷积与 LTI 响应 | [第七周](self/第七周/README.md) |
| 4 | 第 8 周 | 差分方程、历史值、响应分解 | [第八周](self/第八周/README.md) |
| 5 | 第 9 周 | DTFT、频率响应、卷积定理 | [第九周](self/第九周/README.md) |
| 6 | 第 10 周 | z / ROC、典型逆变换、零极点；第二章结项 | [第十周](self/第十周/README.md) |
| 7 | 第 11 周 | DFT/FFT、窗函数、幅度与相位 | [第十一周](self/第十一周/README.md) |
| 8 | 第 12 周 | FIR/IIR 设计、前后对照、双频与噪声 | [第十二周](self/第十二周/README.md) |
| 9 | 第 13 周 | 导入导出复现、规则助手、本地工具接口 | [第十三周](self/第十三周/README.md) |

每个周目录的 `index.html` 都冻结了当时功能。次数指课程交付，不是 Git 提交总数；课程周次不绑定当前日历日期。

## 当前能做什么

- 生成正弦、余弦、脉冲、阶跃、可调双频和固定种子的均匀噪声；也可手动输入或导入 CSV。
- 对最多 4096 个实样值，按顺序组合最多 8 个操作；负下标、采样率、原始输入和每步输出均保留。
- 序列变换、完整线性卷积、因果差分方程与初始历史；有限 DTFT、复数 z 求值和低阶系统实验。
- 直接 DFT / 基 2 FFT、单边幅度/主值相位、矩形/Hann/Hamming 分析窗、补零、去均值。
- FIR 窗函数低通/高通和二阶 Butterworth IIR 低通/高通，波形与频谱叠加、系数、响应与延迟说明。
- 下载原始/输出 CSV、任务 JSON、Markdown 实验报告。任务 JSON 内嵌导入数据，恢复不依赖原 CSV 的路径。
- 离线规则助手将限定表达转为任务，预览后调用同一个 DSP 入口。不能理解任意自然语言。

详细边界见 [本地验收](docs/本地验证指南.md) 和 [第二章实验验收](docs/第二章实验验收.md)。通用符号逆变换、带通/带阻、PSD、量化、实时采集未实现。没有采样率时仍可按下标分析，频谱单位为 cycles/sample；Hz 滤波设计要求有效采样率。

## 可选：启动本地后端

只试离线实验不需要这一步。要验证未来 Agent 的工具调用链，安装 **Node.js 20+**，在项目目录运行：

```bash
npm start
```

浏览器打开 `http://127.0.0.1:8787`。也可在 Windows 双击 `start-local.cmd`，macOS/Linux 执行 `./start-local.sh`；启动后按终端提示打开地址。无需 `npm install`。结束时在终端按 Ctrl+C。

在“保存、复现与本地服务”点击 **本地工具自检**。网页将当前信号存入本机内存，模拟助手调用 `get_signal_info → run_analysis`，再取回结果与浏览器计算核对。

**v0.9 的后端是本机模拟工具模式，未发送任何真实模型请求，也不接收或保存 API Key。** 第 10 次将实现 OpenAI 设置、后端适配与本地密钥保存，第 11 次实现 DeepSeek。预定的密钥位置为用户配置目录，详细方案见 [模型接入工程方案](docs/模型接入工程方案.md)。当前不要将密钥写入 HTML、任务 JSON 或仓库。

## 开发与验证

页面、后端及 Node 测试无第三方运行时依赖。

```bash
npm test
npm run build:offline
```

`build:offline` 默认只重建 `package.json` 中的当前交付路径（现在为第十三周），不覆盖历史周。临时输出可指定：

```bash
node scripts/build-offline.cjs /tmp/dsp-preview.html
```

浏览器验证是可选开发工具，需要 Python、Playwright 和 Chromium：

```bash
python -m pip install playwright
python -m playwright install chromium
python tests/browser_smoke.py
python tests/deliveries_browser.py
python tests/local_browser.py
```

可用 `DSP_CHROMIUM_PATH` 指定已有 Chromium。基础脚本尝试 `file://`；本次云浏览器明确禁止该方式，因此采用本地 HTTP 检查源码，并在断网状态加载单文件内容。该替代验证不等于用户电脑已完成双击验证，请按 [本地验证指南](docs/本地验证指南.md) 检查。

滤波参考固定在 `tests/fixtures/filters.json`，由 SciPy 1.17.0 独立生成；平时测试不需 SciPy。重新生成需要 NumPy/SciPy，命令 `python scripts/reference_filters.py`。

## 文件入口

```text
index.html / styles.css / src/  当前页面、共享 DSP、规则助手
server/                        本机 HTTP、工具契约、受限模拟 Runner
self/第五周 … 第十三周/          各次独立 HTML 与周报
examples/                      CSV 和可导入的实验任务
scripts/                       打包、发布与独立参考生成
tests/                         数值、HTTP、工具流程与浏览器验证
docs/                          规划、章节验收、接口和本地操作文档
课程项目-任务书与参考案例-学生发布包/ 教师原始材料（保留）
```

- [课程项目规划](docs/课程项目规划.md)
- [本地验证指南](docs/本地验证指南.md)
- [任务与工具接口](docs/任务与工具接口.md)
- [验证记录](docs/验证记录.md)

本地有修改时先保存自己的改动再拉取。报告问题时附浏览器版本、任务 JSON、预期与实际结果即可。

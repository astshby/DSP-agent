# 实验文件

在最新第十三周页面，展开“保存、复现与本地服务”，选择 JSON 后点击“导入并复现”。历史版本尚无 JSON 导入按钮，可按对应周报手动输入相同参数。

| 文件 | 预期结果 |
|---|---|
| sampling.csv | 数值列 2、时间列 1、有表头；fs=1000，8 项 |
| 02-transform.json | [6,4,2]，首项下标 3 |
| 03-convolution.json | [1,3,4,3,1]，首项下标 −3 |
| 04-initial-state.json | 全响应 [2,2,2]，零状态与零输入之和 |
| 05-dtft.json | DC 幅度 4，卷积定理残差接近机器精度 |
| 06-z-roc.json | 极点 0.5，比较同表达式不同 ROC 的逆变换 |
| 07-spectrum.json | DFT/FFT 同为 4 Hz 幅度 2、DC 幅度 0.25 |
| 08-filter.json | 50 Hz + 300 Hz 输入，低通后高频受抑制，FIR 延迟 25 项 |

JSON 内嵌输入或完整发生器参数；不含 API Key、机器路径或外部资源。

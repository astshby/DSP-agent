# OpenAI / DeepSeek 的账号、费用与接入安排

v1.0 已实现第 10 次的 **OpenAI 官方 API** 适配和第 11 次的 **DeepSeek 官方 API** 适配，两家共用任务校验与 DSP 工具。代码和模拟协议已验证；实际账号权限、余额、模型可用性需本机测试。

## ChatGPT 订阅是否包含 API

**ChatGPT Plus / Pro 订阅与 OpenAI API 分开计费，订阅本身不包含 API 调用额度。** 可以使用相应账号访问开发者平台，但仍需在 API 平台创建 API Key、查看可用模型，并单独设置 API 计费。若账号有赠送或活动额度，以开发者平台显示为准，不以 ChatGPT 订阅状态推断。

在 ChatGPT 或 Codex 中使用模型，与让自己的 DSP 网页调用模型，是不同的产品入口。订阅中的聊天或 Codex 使用权益，不会自动成为这个网页可使用的 API Key 或 API 余额。

| 项目 | ChatGPT / DeepSeek 聊天页面 | 本项目使用的官方 API |
|---|---|---|
| 操作入口 | 人在聊天产品中使用 | 本地后端向服务商发送请求 |
| 账号凭据 | 聊天登录会话 | 在对应开发者平台生成的 API Key |
| 费用 | 按聊天产品自己的套餐与规则 | 按 API 账户和实际请求计费 |
| 可否直接复用订阅权益 | 取决于聊天产品 | 不能默认把聊天订阅当 API 额度 |

DeepSeek 的聊天网站可用，也不代表其 API 免费或已经充值。接入时在官方开放平台创建 Key，并核对 API 账户余额和当时的模型价格。

## 最终网页怎样使用 API

1. 安装并启动本地后端，浏览器打开本机页面。
2. 在设置页选择 OpenAI 或 DeepSeek，填写可用模型名和 API Key。
3. 后端按用户选择，将 Key 保存在本机用户配置目录。页面只显示已配置状态或掩码。
4. 用户发出要求，后端调用模型；模型返回工具名称和参数，本地程序校验并执行 DSP，再将必要结果摘要交给模型解释。

首版端点固定为 `https://api.openai.com/v1/chat/completions` 和 `https://api.deepseek.com/chat/completions`，采用非流式 function tool calls。默认模型分别为 `gpt-4.1-mini` 和 `deepseek-chat`，可在设置中修改为账号实际可用且支持工具调用的模型 ID。默认值不是对账号权限或长期可用性的保证；本次没有实时核验供应商模型列表。

一次实验可能包含多轮模型请求，费用与模型及 token 数有关；本地卷积、FFT、滤波不产生 API 费用。首版限制 6 轮、8 次工具调用、90 秒，不显示金额或 token 账单，请以官方控制台为准。连接测试也会调用模型与工具，可能收费。

密钥仅在本机页面输入；不要发到聊天、任务 JSON 或 GitHub。使用步骤和本地保存位置见 [模型使用与首版验收](模型使用与首版验收.md)。

## 官方入口与核对范围

- [OpenAI：ChatGPT Plus 说明](https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus)
- [OpenAI：ChatGPT 订阅与 API 的关系](https://help.openai.com/en/articles/8156019-how-can-i-move-my-chatgpt-subscription-to-the-api)
- [OpenAI 开发者平台](https://platform.openai.com/)
- [OpenAI API 价格](https://openai.com/api/pricing/)
- [DeepSeek 开放平台](https://platform.deepseek.com/)
- [DeepSeek 官方 API 文档与价格](https://api-docs.deepseek.com/quick_start/pricing)

本次尝试访问官方帮助/价格页时，云环境网络代理返回 403，未能现场重新读取最新页面。因此这里说明账号与计费边界，不引用未经实时核对的具体模型价格、赠送额度或套餐细则；实际开通时以官方平台显示为准。

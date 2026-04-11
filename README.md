# doudian-review-insight

一个本地优先的抖店评论分析 Web 应用，用来在你自己的电脑上导入评论 Excel、提取痛点，并查看多店铺的可视化分析结果。

## 项目用途

- 在一个工作台里管理多个店铺
- 维护商品元数据，例如别名、分类和备注
- 上传评论 Excel，并将每个上传批次绑定到指定店铺
- 按文件内容对同店铺的重复上传做去重
- 支持三种评论分析模式：
  - `rules_only`
  - `llm_only`
  - `hybrid`
- 使用 SQLite 在本地持久化保存数据
- 查看总览、历史痛点、近期开启的新痛点和原始评论
- 使用单密码保护本地工作台

## 技术栈

- React 19 + Vite + TypeScript
- Express + TypeScript
- SQLite + Drizzle + `@libsql/client`
- Wouter
- TanStack Query
- Zod
- Recharts
- OpenAI 兼容 LLM 接口

## 主要页面

- `总览`：查看核心指标和最近趋势
- `店铺`：创建和管理店铺
- `商品`：按店铺维护商品元数据
- `上传`：导入评论 Excel 批次
- `分析设置`：切换规则 / LLM 分析模式，并在前端本地配置 LLM 接口
- `痛点`：查看历史痛点和近期新增痛点
- `评论`：搜索和筛选原始评论

## 运行要求

- Node.js 20+
- pnpm 10+
- Windows、macOS 或 Linux

## 快速开始

```bash
pnpm install
copy .env.example .env
pnpm drizzle:migrate
pnpm dev
```

启动后访问：

- 前端：`http://localhost:5173`
- 后端 API：`http://localhost:5174`

## 环境变量配置

先复制 `.env.example` 为 `.env`，至少需要确认这些配置：

```env
PORT=5174
NODE_ENV=development
APP_PASSWORD=change-me-please
SESSION_SECRET=replace-with-a-long-random-secret
DATA_DIR=./data
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
LLM_BATCH_SIZE=20
LLM_MAX_CONCURRENCY=3
RULES_PATH=./server/jobs/rules/zh.json
```

说明：

- `APP_PASSWORD` 至少需要 12 位
- `SESSION_SECRET` 至少需要 32 位
- `OPENAI_*` 这些值只是首次启动时的默认分析配置
- 应用启动后，你可以直接在前端 `分析设置` 页面里修改分析参数，并持久化保存到本地数据库
- 如果你只想使用规则分析，可以在 `分析设置` 页面切换到 `rules_only`

## 常用脚本

```bash
pnpm dev              # 同时启动前端和后端开发环境
pnpm check            # 运行 TypeScript 类型检查
pnpm test             # 运行测试
pnpm build            # 构建前端和后端
pnpm start            # 从 dist 启动生产模式服务
pnpm drizzle:migrate  # 执行数据库迁移
pnpm drizzle:generate # 生成新的 Drizzle 迁移文件
```

## 分析模式

应用在 `分析设置` 页面中支持三种分析策略：

- `rules_only`：只使用本地关键词规则
- `llm_only`：把评论文本直接发给配置好的 LLM 接口进行抽取
- `hybrid`：优先使用规则，规则未命中时再回退到 LLM

本地保存的 LLM 配置包括：

- API Base URL
- API Key
- 模型名称
- 批大小
- 最大并发数

前端在保存后不会再次展示完整 API Key，只会显示脱敏后的遮罩值。

## 上传流程

上传一份 Excel 时，系统会按下面的流程处理：

1. 将该批次关联到你当前选择的店铺
2. 规范化文件名，并把文件临时保存到本地目录
3. 对文件内容生成哈希值
4. 如果同店铺已经存在内容相同且不是失败状态的上传记录，则直接拦截为重复上传
5. 对新数据执行解析、去重、分析，并合并写入本地 SQLite

## 本地数据目录

运行时数据保存在 `data/` 下，并且默认不会进入 git：

- `data/app.db`：SQLite 数据库
- `data/uploads-tmp/`：临时保存的上传 Excel 文件
- `data/logs/`：应用日志

## 生产构建

```bash
pnpm build
pnpm start
```

生产模式下，Express 会直接托管 `dist/client` 里的前端静态资源，因此整个应用只需要一个端口即可运行。

## 当前验证状态

当前代码已经完成以下基础验证：

- `pnpm check`
- `pnpm test`
- `pnpm build`
- `pnpm drizzle:migrate`

## 项目结构

```text
client/   React 前端
server/   Express API、后台任务、认证和数据库接线
shared/   前后端共享的 Zod schema 和 TypeScript 类型
drizzle/  SQL 迁移文件和元数据
data/     本地运行数据目录，已被 git 忽略
```

## 说明

- 这是一个本地优先工具，不是云端部署产品
- 项目不依赖抖店开放平台 API，评论数据通过手动导出的 Excel 导入
- 整个分析流程尽量保持通用，不会把 prompt 或规则硬编码成某个特定行业

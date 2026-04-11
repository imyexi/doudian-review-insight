# doudian-review-insight

A local-first web app for importing Douyin shop review Excel files, extracting pain points, and visualizing multi-shop insights on your own machine.

## What It Does

- Manage multiple shops in one workspace
- Maintain product metadata such as aliases, categories, and notes
- Upload review Excel files and link each batch to a specific shop
- Deduplicate repeated uploads by file content within the same shop
- Extract pain points with three analysis modes:
  - `rules_only`
  - `llm_only`
  - `hybrid`
- Persist data locally in SQLite
- Browse dashboard stats, pain point history, recent additions, and raw reviews
- Protect the workspace with a single local password

## Stack

- React 19 + Vite + TypeScript
- Express + TypeScript
- SQLite via Drizzle + `@libsql/client`
- Wouter
- TanStack Query
- Zod
- Recharts
- OpenAI-compatible LLM API

## Main Screens

- `总览` - overview metrics and recent trends
- `店铺` - create and manage shops
- `商品` - maintain product metadata by shop
- `上传` - import Excel review batches
- `分析设置` - switch between rules and LLM analysis modes, configure the LLM endpoint locally
- `痛点` - historical and recent pain point views
- `评论` - search and filter raw reviews

## Requirements

- Node.js 20+
- pnpm 10+
- Windows, macOS, or Linux

## Quick Start

```bash
pnpm install
copy .env.example .env
pnpm drizzle:migrate
pnpm dev
```

Then open:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:5174`

## Environment Setup

Copy `.env.example` to `.env` and update at least these values:

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

Notes:

- `APP_PASSWORD` must be at least 12 characters
- `SESSION_SECRET` must be at least 32 characters
- The `OPENAI_*` values are startup defaults only
- After the app starts, you can update analysis settings from the frontend and the values are persisted in the local database
- If you only want rule-based analysis, you can keep the app in `rules_only` mode from the `分析设置` page

## Scripts

```bash
pnpm dev              # run frontend and backend in development
pnpm check            # run TypeScript typecheck
pnpm test             # run tests
pnpm build            # build client and server
pnpm start            # run the production server from dist
pnpm drizzle:migrate  # run database migrations
pnpm drizzle:generate # generate new Drizzle migrations
```

## Analysis Modes

The app supports three analysis strategies in `分析设置`:

- `rules_only` - local keyword rules only
- `llm_only` - send review text directly to the configured LLM endpoint
- `hybrid` - use rules first, then fall back to LLM when needed

LLM settings are stored locally and include:

- API base URL
- API key
- model name
- batch size
- max concurrency

The frontend never displays the full saved API key again after save; it only shows a masked version.

## Upload Behavior

When you upload an Excel file:

1. The batch is associated with the selected shop
2. The server normalizes the file name and stores the file temporarily
3. The server hashes the file contents
4. If the same shop already has a non-failed upload with the same file hash, the upload is rejected as a duplicate
5. New rows are parsed, deduplicated, analyzed, and merged into local SQLite data

## Local Data

Runtime data is stored under `data/` and is intentionally ignored by git:

- `data/app.db` - SQLite database
- `data/uploads-tmp/` - temporary uploaded Excel files
- `data/logs/` - app logs

## Production Build

```bash
pnpm build
pnpm start
```

In production mode, Express serves the built frontend from `dist/client`, so the app runs on a single port.

## Current Validation Status

The current codebase has been validated with:

- `pnpm check`
- `pnpm test`
- `pnpm build`
- `pnpm drizzle:migrate`

## Project Structure

```text
client/   React frontend
server/   Express API, jobs, auth, and database wiring
shared/   shared Zod schemas and TypeScript types
drizzle/  SQL migrations and metadata
data/     local runtime data, ignored by git
```

## Notes

- This project is built for local-first usage rather than cloud deployment
- It does not rely on Douyin open platform APIs; review data is imported manually from exported Excel files
- The app is designed to stay generic and not hardcode any industry-specific prompt behavior

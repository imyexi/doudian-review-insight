# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `pnpm install` — install dependencies
- `copy .env.example .env` (Windows) or `cp .env.example .env` (macOS/Linux) — create local env file
- `pnpm drizzle:migrate` — apply database migrations to the local SQLite DB
- `pnpm dev` — run client and server together
- `pnpm dev:client` — run Vite on `http://localhost:5173`
- `pnpm dev:server` — run the Express API on `http://localhost:5174`
- `pnpm check` — run TypeScript type checking
- `pnpm test` — run the full Vitest suite
- `pnpm test -- shared/analysisSettings.test.ts` — run a single test file
- `pnpm test -- shared/analysisSettings.test.ts -t "returns defaults"` — run one named test
- `pnpm build` — build client and server
- `pnpm start` — serve the production build from `dist/server/index.js`
- `pnpm drizzle:generate` — generate a new Drizzle migration after schema changes

## Architecture

This is a local-first Douyin shop review analysis workspace. Users manually export review Excel files from 抖店, upload them into the app, and the app parses, deduplicates, analyzes, and visualizes the data locally.

### Runtime shape

- `client/` is a React 19 + Vite SPA
- `server/` is an Express API plus background analysis jobs
- `shared/` contains Zod schemas and shared TS types used by both client and server
- `drizzle/` contains SQL migrations and Drizzle metadata
- `data/` is the local runtime state directory (`app.db`, temp uploads, logs)

### Frontend

- App entry is `client/src/App.tsx`
- Navigation uses Wouter, not React Router
- Data fetching/mutations use TanStack Query
- Selected shop state is global via `client/src/hooks/useShop.tsx` and persisted in localStorage
- The Vite root is `client/`, and `/api` is proxied to `http://localhost:5174` in dev
- `client/src/api/client.ts` is the shared HTTP wrapper; auth failures redirect to login unless explicitly disabled

### Backend

- `server/index.ts` wires the API and serves `dist/client` in production
- `/api/auth` is public; the rest of `/api` is protected by the signed-cookie gate in `server/auth.ts`
- Route modules under `server/routes/` are thin HTTP layers around DB access and analysis services
- Environment parsing and derived paths live in `server/env.ts`
- DB bootstrap is in `server/db/client.ts`; SQLite is opened through `@libsql/client` and initialized with PRAGMAs such as foreign keys and WAL mode

### Data model

`server/db/schema.ts` is the source of truth for the domain model. Important relationships:

- `shops` are the tenant boundary for almost every query
- `products` are the raw imported Douyin product identities (`doudianProductId` per shop)
- `product_groups` are the higher-level grouping unit for similar products
- `reviews` keep both `productRefId` and `productGroupId`
- `pain_points` now aggregate by `shopId + productGroupId + canonicalLabel`
- `pain_point_evidence` preserves review-level traceability for each pain point
- `analysis_settings` persists the runtime extraction strategy and LLM config in the DB; env vars only provide defaults

When changing API payloads, update `shared/types.ts` first so the client and server stay aligned.

### Upload and analysis pipeline

The key flow is:

1. `server/routes/uploads.ts` stores the file locally, hashes it, and rejects duplicate uploads within the same shop
2. the upload is queued through `server/jobs/queue.ts`
3. `server/jobs/analyze.ts` parses the Excel, upserts products, resolves product grouping, inserts reviews, and triggers pain point analysis
4. extraction logic combines rule-based matching (`server/jobs/rules.ts`) and optional LLM extraction (`server/jobs/llm.ts`) depending on `analysis_settings`
5. aggregation and rebuild logic live in `server/services/`, including regroup-related recomputation

The queue is in-process and sequential, so uploads are analyzed one at a time.

### Product grouping model

The codebase is in the middle of a redesign away from “one product ID = one pain point bucket” toward grouped analysis:

- imported products remain raw records in `products`
- short names are derived from imported names and used to attach products to `product_groups`
- pain points are intended to be shared across similar items in the same shop by grouping on `productGroupId`
- manual regrouping is handled from the product-management flow and should trigger historical recomputation for affected groups

If you touch grouping behavior, inspect all of these together:

- `server/db/schema.ts`
- `server/jobs/analyze.ts`
- `server/services/productGrouping.ts`
- `server/services/painPointAggregation.ts`
- `server/routes/products.ts`
- `server/routes/painPoints.ts`
- `server/routes/reviews.ts`
- `server/routes/stats.ts`
- `shared/types.ts`
- `client/src/routes/ProductsPage.tsx`

### Conventions that matter here

- Prefer Zod schemas in `shared/types.ts` for request/response contracts and shared enums
- Keep routes thin and put reusable domain logic in `server/services/` or focused utilities
- This app is intentionally local-first: avoid assuming cloud storage, background workers, or Douyin open-platform APIs
- Keep shop scoping explicit in backend queries; most entities are only meaningful within a shop
- For frontend work, preserve the current AppShell + selected-shop workflow instead of introducing route-local shop state

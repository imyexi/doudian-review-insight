import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const [baseUrl, password, excelPath, settingsMode = "rules_only"] = process.argv.slice(2);

if (!baseUrl || !password || !excelPath) {
  throw new Error("Usage: node scripts/tmp-import-validation.mjs <baseUrl> <password> <excelPath> [settingsMode]");
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${url} failed: ${response.status} ${text}`);
  }

  return payload;
}

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ password }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Login failed: ${response.status} ${text}`);
  }

  const cookie = response.headers.get("set-cookie");
  if (!cookie) {
    throw new Error("Login succeeded without session cookie");
  }

  return cookie.split(";", 1)[0] ?? cookie;
}

async function loadAnalysisSettings(cookie) {
  const payload = await requestJson(`${baseUrl}/api/settings/analysis`, {
    headers: { cookie },
  });

  return payload.data;
}

async function main() {
  const cookie = await login();
  const shopPayload = await requestJson(`${baseUrl}/api/shops`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify({
      name: `Validation ${Date.now()}`,
      doudianShopId: "",
      description: "Automated validation run",
    }),
  });

  const shopId = shopPayload.data.id;
  const currentSettings = await loadAnalysisSettings(cookie);

  if (settingsMode === "rules_only") {
    await requestJson(`${baseUrl}/api/settings/analysis`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        analysisMode: "rules_only",
        openaiBaseUrl: currentSettings.openaiBaseUrl,
        openaiModel: currentSettings.openaiModel,
        llmBatchSize: currentSettings.llmBatchSize,
        llmMaxConcurrency: currentSettings.llmMaxConcurrency,
        llmProductNameEnabled: false,
      }),
    });
  } else if (settingsMode !== "preserve") {
    throw new Error(`Unsupported settings mode: ${settingsMode}`);
  }

  const effectiveSettings = await loadAnalysisSettings(cookie);

  const form = new FormData();
  form.append("shopId", String(shopId));
  form.append(
    "file",
    new Blob([fs.readFileSync(excelPath)]),
    path.basename(excelPath),
  );

  const uploadPayload = await requestJson(`${baseUrl}/api/uploads`, {
    method: "POST",
    headers: {
      cookie,
    },
    body: form,
  });

  const uploadId = uploadPayload.data.uploadId;
  let upload = null;

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const uploadsPayload = await requestJson(`${baseUrl}/api/uploads?shopId=${shopId}`, {
      headers: { cookie },
    });
    upload = uploadsPayload.data.find(item => item.id === uploadId) ?? null;

    if (upload && ["done", "failed"].includes(upload.status)) {
      break;
    }

    await delay(1000);
  }

  if (!upload) {
    throw new Error(`Upload ${uploadId} was not found while polling`);
  }

  if (upload.status !== "done") {
    throw new Error(`Upload ${uploadId} did not complete successfully: ${JSON.stringify(upload)}`);
  }

  const [statsPayload, productsPayload, painPointsPayload, noteworthyPayload] = await Promise.all([
    requestJson(`${baseUrl}/api/stats/overview?shopId=${shopId}`, { headers: { cookie } }),
    requestJson(`${baseUrl}/api/shops/${shopId}/products`, { headers: { cookie } }),
    requestJson(`${baseUrl}/api/pain-points?shopId=${shopId}&mode=historical&sort=occurrence`, { headers: { cookie } }),
    requestJson(`${baseUrl}/api/pain-points/noteworthy?shopId=${shopId}`, { headers: { cookie } }),
  ]);

  const firstPainPoint = painPointsPayload.data[0] ?? null;
  const reviewsPayload = firstPainPoint
    ? await requestJson(
        `${baseUrl}/api/reviews?shopId=${shopId}&painPointId=${firstPainPoint.id}&page=1&pageSize=5`,
        { headers: { cookie } },
      )
    : { ok: true, data: { items: [], total: 0, page: 1, pageSize: 5 } };

  const summary = {
    shopId,
    settingsMode,
    analysisSettings: {
      analysisMode: effectiveSettings.analysisMode,
      openaiBaseUrl: effectiveSettings.openaiBaseUrl,
      openaiModel: effectiveSettings.openaiModel,
      llmBatchSize: effectiveSettings.llmBatchSize,
      llmMaxConcurrency: effectiveSettings.llmMaxConcurrency,
      llmProductNameEnabled: effectiveSettings.llmProductNameEnabled,
      hasApiKey: effectiveSettings.hasApiKey,
    },
    upload: {
      id: upload.id,
      status: upload.status,
      rowCount: upload.rowCount,
      progressCurrent: upload.progressCurrent,
      progressTotal: upload.progressTotal,
      error: upload.error,
    },
    stats: statsPayload.data,
    products: {
      count: productsPayload.data.length,
      sample: productsPayload.data.slice(0, 5).map(product => ({
        id: product.id,
        doudianProductId: product.doudianProductId,
        rawName: product.rawName,
        shortName: product.shortName,
        llmExtractedName: product.llmExtractedName,
        productGroupId: product.productGroupId,
      })),
    },
    painPoints: {
      count: painPointsPayload.data.length,
      sample: painPointsPayload.data.slice(0, 5).map(point => ({
        id: point.id,
        canonicalLabel: point.canonicalLabel,
        category: point.category,
        sentiment: point.sentiment,
        specificityScore: point.specificityScore,
        occurrenceCount: point.occurrenceCount,
        excerpt: point.topEvidence?.[0]?.excerpt ?? null,
      })),
    },
    noteworthy: noteworthyPayload.data.map(point => ({
      id: point.id,
      canonicalLabel: point.canonicalLabel,
      specificityScore: point.specificityScore,
      occurrenceCount: point.occurrenceCount,
    })),
    firstPainPointReviews: reviewsPayload.data.items.map(review => ({
      id: review.id,
      productName: review.productName,
      productSpec: review.productSpec,
      rating: review.rating,
      content: review.content,
    })),
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});

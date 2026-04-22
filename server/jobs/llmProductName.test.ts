import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMock, warnMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  warnMock: vi.fn(),
}));

vi.mock("../utils/logger", () => ({
  logger: {
    warn: warnMock,
  },
}));

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: createMock,
      },
    },
  })),
}));

import { extractProductNamesWithLlm } from "./llmProductName";

function createMockStream(chunks: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

describe("extractProductNamesWithLlm", () => {
  beforeEach(() => {
    createMock.mockReset();
    warnMock.mockReset();
  });

  it("uses streaming chat completions and parses product names", async () => {
    createMock.mockResolvedValue(
      createMockStream([
        {
          choices: [
            {
              delta: {
                content: '{"product-1":"轻透防晒乳"}',
              },
              finish_reason: "stop",
            },
          ],
        },
      ]),
    );

    const result = await extractProductNamesWithLlm(
      [{ doudianProductId: "product-1", rawTitle: "美康粉黛轻透防晒乳50g SPF50+" }],
      {
        analysisMode: "llm_only",
        openaiApiKey: "test-key",
        openaiBaseUrl: "http://example.com/openai/v1",
        openaiModel: "gpt-5.4",
        llmBatchSize: 20,
        llmMaxConcurrency: 3,
        llmProductNameEnabled: true,
        updatedAt: 0,
      },
    );

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith(
      {
        model: "gpt-5.4",
        stream: true,
        messages: [
          {
            role: "system",
            content: [
              "你是商品名称提取助手。",
              "请从电商商品标题中提取核心商品名（不超过 15 字）。",
              "去掉营销词、规格参数（重量/数量/尺寸）、产地、品牌修饰、促销信息等无关内容。",
              "只保留能识别商品本质类别和关键特征（如口味、款式）的最短名称。",
              "输出严格 JSON 对象，键为商品ID，值为提取出的核心商品名字符串。",
              "不要输出 markdown，不要输出代码块，只返回 JSON。",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify([{ doudianProductId: "product-1", rawTitle: "美康粉黛轻透防晒乳50g SPF50+" }]),
          },
        ],
      },
      {
        timeout: 30000,
      },
    );
    expect(result).toEqual({ "product-1": "轻透防晒乳" });
  });

  it("parses fenced json product-name content", async () => {
    createMock.mockResolvedValue(
      createMockStream([
        {
          choices: [
            {
              delta: {
                content: "```json\n{",
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                content: '\"product-2\":\"清爽防晒喷雾\"',
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                content: "}\n```",
              },
              finish_reason: "stop",
            },
          ],
        },
      ]),
    );

    const result = await extractProductNamesWithLlm(
      [{ doudianProductId: "product-2", rawTitle: "美康粉黛清爽防晒喷雾150ml" }],
      {
        analysisMode: "llm_only",
        openaiApiKey: "test-key",
        openaiBaseUrl: "http://example.com/openai/v1",
        openaiModel: "gpt-5.4",
        llmBatchSize: 20,
        llmMaxConcurrency: 3,
        llmProductNameEnabled: true,
        updatedAt: 0,
      },
    );

    expect(result).toEqual({ "product-2": "清爽防晒喷雾" });
  });

  it("returns an empty result and warns when the streamed payload is invalid", async () => {
    createMock.mockResolvedValue(
      createMockStream([
        {
          choices: [
            {
              delta: {
                content: '{"product-3":42}',
              },
            },
          ],
        },
      ]),
    );

    const result = await extractProductNamesWithLlm(
      [{ doudianProductId: "product-3", rawTitle: "美康粉黛修护防晒乳" }],
      {
        analysisMode: "llm_only",
        openaiApiKey: "test-key",
        openaiBaseUrl: "http://example.com/openai/v1",
        openaiModel: "gpt-5.4",
        llmBatchSize: 20,
        llmMaxConcurrency: 3,
        llmProductNameEnabled: true,
        updatedAt: 0,
      },
    );

    expect(result).toEqual({});
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0]?.[1]).toBe("ignored invalid llm product-name response");
  });

  it("splits requests into batches and merges worker results", async () => {
    createMock
      .mockResolvedValueOnce(
        createMockStream([
          {
            choices: [
              {
                delta: {
                  content: '{"product-1":"防晒乳","product-2":"隔离乳"}',
                },
              },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(
        createMockStream([
          {
            choices: [
              {
                delta: {
                  content: '{"product-3":"妆前乳"}',
                },
              },
            ],
          },
        ]),
      );

    const result = await extractProductNamesWithLlm(
      [
        { doudianProductId: "product-1", rawTitle: "商品 1" },
        { doudianProductId: "product-2", rawTitle: "商品 2" },
        { doudianProductId: "product-3", rawTitle: "商品 3" },
      ],
      {
        analysisMode: "llm_only",
        openaiApiKey: "test-key",
        openaiBaseUrl: "http://example.com/openai/v1",
        openaiModel: "gpt-5.4",
        llmBatchSize: 2,
        llmMaxConcurrency: 2,
        llmProductNameEnabled: true,
        updatedAt: 0,
      },
    );

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      "product-1": "防晒乳",
      "product-2": "隔离乳",
      "product-3": "妆前乳",
    });
  });
});

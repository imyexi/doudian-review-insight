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

import { extractPainPointsWithLlm } from "./llm";

function createMockStream(chunks: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

describe("extractPainPointsWithLlm", () => {
  beforeEach(() => {
    createMock.mockReset();
    warnMock.mockReset();
  });

  it("uses streaming chat completions and normalizes candidates", async () => {
    createMock.mockResolvedValue(
      createMockStream([
        {
          choices: [
            {
              delta: {
                role: "assistant",
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                content: '{"1":[{"canonicalLabel":"物流慢",',
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                content: '"category":"物流","excerpt":"快递特别慢"}]}',
              },
              finish_reason: "stop",
            },
          ],
        },
      ]),
    );

    const result = await extractPainPointsWithLlm(
      [{ reviewId: 1, content: "快递特别慢，包装也破了" }],
      {
        analysisMode: "llm_only",
        openaiApiKey: "test-key",
        openaiBaseUrl: "http://example.com/openai/v1",
        openaiModel: "gpt-5.4",
        llmBatchSize: 20,
        llmMaxConcurrency: 3,
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
              "你是评论痛点抽取助手。",
              "请从评论中识别负面问题，只允许使用以下分类：质量、物流、款式外观、客服、价格、使用体验、其他。",
              "输出严格 JSON 对象，键为 reviewId，值为数组。每个数组项包含 canonicalLabel、category、excerpt。",
              "不要输出 markdown，不要输出代码块，只返回 JSON。",
              "label 必须是 15 字以内的通用名词短语，不要引入任何行业词。",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify([{ reviewId: 1, content: "快递特别慢，包装也破了" }]),
          },
        ],
      },
      {
        timeout: 30000,
      },
    );
    expect(result).toEqual({
      1: [
        {
          canonicalLabel: "物流慢",
          category: "物流",
          excerpt: "快递特别慢",
          source: "llm",
        },
      ],
    });
  });

  it("parses fenced json content from streamed gateway chunks", async () => {
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
                content: '\"2\":[{\"canonicalLabel\":\"客服慢\",\"category\":\"客服\",',
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                content: '\"excerpt\":\"回复很敷衍\"}]}\n```',
              },
              finish_reason: "stop",
            },
          ],
        },
      ]),
    );

    const result = await extractPainPointsWithLlm(
      [{ reviewId: 2, content: "客服回复很敷衍" }],
      {
        analysisMode: "llm_only",
        openaiApiKey: "test-key",
        openaiBaseUrl: "http://example.com/openai/v1",
        openaiModel: "gpt-5.4",
        llmBatchSize: 20,
        llmMaxConcurrency: 3,
        updatedAt: 0,
      },
    );

    expect(result).toEqual({
      2: [
        {
          canonicalLabel: "客服慢",
          category: "客服",
          excerpt: "回复很敷衍",
          source: "llm",
        },
      ],
    });
  });

  it("ignores streamed chunks without delta content", async () => {
    createMock.mockResolvedValue(
      createMockStream([
        {
          choices: [],
        },
        {
          choices: [
            {
              delta: {
                role: "assistant",
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {},
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                content: '{"3":[{"canonicalLabel":"包装破损","category":"质量","excerpt":"盒子都压坏了"}]}',
              },
              finish_reason: "stop",
            },
          ],
        },
      ]),
    );

    const result = await extractPainPointsWithLlm(
      [{ reviewId: 3, content: "盒子都压坏了" }],
      {
        analysisMode: "llm_only",
        openaiApiKey: "test-key",
        openaiBaseUrl: "http://example.com/openai/v1",
        openaiModel: "gpt-5.4",
        llmBatchSize: 20,
        llmMaxConcurrency: 3,
        updatedAt: 0,
      },
    );

    expect(result).toEqual({
      3: [
        {
          canonicalLabel: "包装破损",
          category: "质量",
          excerpt: "盒子都压坏了",
          source: "llm",
        },
      ],
    });
  });

  it("returns an empty result and warns when the streamed JSON is truncated", async () => {
    createMock.mockResolvedValue(
      createMockStream([
        {
          choices: [
            {
              delta: {
                content: '{"4":[{"canonicalLabel":"客服慢"',
              },
            },
          ],
        },
      ]),
    );

    const result = await extractPainPointsWithLlm(
      [{ reviewId: 4, content: "客服一直不回" }],
      {
        analysisMode: "llm_only",
        openaiApiKey: "test-key",
        openaiBaseUrl: "http://example.com/openai/v1",
        openaiModel: "gpt-5.4",
        llmBatchSize: 20,
        llmMaxConcurrency: 3,
        updatedAt: 0,
      },
    );

    expect(result).toEqual({});
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0]?.[1]).toBe("ignored invalid llm batch response");
  });

  it("returns an empty result and warns when the streamed payload has an invalid category", async () => {
    createMock.mockResolvedValue(
      createMockStream([
        {
          choices: [
            {
              delta: {
                content: '{"5":[{"canonicalLabel":"描述异常","category":"售后","excerpt":"描述不符合"}]}',
              },
            },
          ],
        },
      ]),
    );

    const result = await extractPainPointsWithLlm(
      [{ reviewId: 5, content: "描述不符合" }],
      {
        analysisMode: "llm_only",
        openaiApiKey: "test-key",
        openaiBaseUrl: "http://example.com/openai/v1",
        openaiModel: "gpt-5.4",
        llmBatchSize: 20,
        llmMaxConcurrency: 3,
        updatedAt: 0,
      },
    );

    expect(result).toEqual({});
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0]?.[1]).toBe("ignored invalid llm batch response");
  });

  it("throws when the streamed response exceeds the maximum size", async () => {
    createMock.mockResolvedValue(
      createMockStream([
        {
          choices: [
            {
              delta: {
                content: "a".repeat(200001),
              },
            },
          ],
        },
      ]),
    );

    await expect(
      extractPainPointsWithLlm(
        [{ reviewId: 6, content: "内容很多" }],
        {
          analysisMode: "llm_only",
          openaiApiKey: "test-key",
          openaiBaseUrl: "http://example.com/openai/v1",
          openaiModel: "gpt-5.4",
          llmBatchSize: 20,
          llmMaxConcurrency: 3,
          updatedAt: 0,
        },
      ),
    ).rejects.toThrow("LLM stream response exceeded maximum size");
  });
});

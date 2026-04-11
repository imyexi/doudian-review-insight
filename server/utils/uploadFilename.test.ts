import { describe, expect, it } from "vitest";
import { normalizeUploadedFilename, serializeUpload } from "./uploadFilename";

describe("normalizeUploadedFilename", () => {
  it("keeps already-correct Chinese filenames unchanged", () => {
    expect(normalizeUploadedFilename("商品评论-2026-04-10 10_19_18.xlsx")).toBe("商品评论-2026-04-10 10_19_18.xlsx");
  });

  it("repairs latin1-style mojibake from multipart uploads", () => {
    expect(normalizeUploadedFilename("ÉÌÆ·ÆÀÂÛ-2026-04-10 10_19_18.xlsx")).toBe("商品评论-2026-04-10 10_19_18.xlsx");
  });

  it("repairs legacy gb18030-to-utf8 mojibake stored in the database", () => {
    expect(normalizeUploadedFilename("鍟嗗搧璇勮-2026-04-10 10_19_18.xlsx")).toBe("商品评论-2026-04-10 10_19_18.xlsx");
  });
});

describe("serializeUpload", () => {
  it("normalizes filenames when returning upload records", () => {
    const upload = {
      id: 1,
      originalFilename: "鍟嗗搧璇勮-2026-04-10 10_19_18.xlsx",
      status: "done",
    };

    expect(serializeUpload(upload)).toEqual({
      ...upload,
      originalFilename: "商品评论-2026-04-10 10_19_18.xlsx",
    });
  });
});

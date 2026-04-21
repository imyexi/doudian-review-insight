import { describe, expect, it } from "vitest";
import { extractProductShortName } from "./productGrouping";

describe("extractProductShortName", () => {
  it("extracts a compact noun phrase from long baked-roll titles", () => {
    expect(
      extractProductShortName("山西纯碱烤馍传统特产手工健康小花卷养胃干馍馒头馍片早餐零食"),
    ).toBe("烤馍");
  });

  it("keeps a useful flavor prefix for nougat biscuit titles", () => {
    expect(
      extractProductShortName("香葱牛轧饼干牛乳夹心葱香苏打饼干咸甜酥脆Q软拉丝休闲零食"),
    ).toBe("香葱牛轧饼干");
  });

  it("retains common descriptive prefixes when they identify the product", () => {
    expect(extractProductShortName("黑糖麻花传统糕点手工零食"))
      .toBe("黑糖麻花");
    expect(extractProductShortName("海苔苏打饼干整箱批发办公室零食"))
      .toBe("海苔苏打饼干");
  });

  it("trims origin and marketing noise around the product core", () => {
    expect(extractProductShortName("山西特产手工麻花休闲零食"))
      .toBe("麻花");
    expect(extractProductShortName("老式传统蛋卷酥脆早餐点心"))
      .toBe("蛋卷");
  });

  it("falls back to cleaned text when no known product suffix matches", () => {
    expect(extractProductShortName("高钙营养早餐代餐食品"))
      .toBe("高钙营养代餐食品");
  });
});

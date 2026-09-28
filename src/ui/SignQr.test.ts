import { describe, expect, it, vi } from "vitest";

const toString = vi.fn(async (text: string) => `<svg data-payload="${text}"></svg>`);
vi.mock("qrcode", () => ({ default: { toString } }));

describe("renderQrSvg", () => {
  it("asks the qrcode library to encode the exact URL as an SVG", async () => {
    const { renderQrSvg } = await import("./SignQr");
    const url = "https://uncommon-men.web.app/events/push-up";
    const svg = await renderQrSvg(url);
    expect(toString).toHaveBeenCalledWith(url, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
    });
    expect(svg).toContain(url);
  });
});

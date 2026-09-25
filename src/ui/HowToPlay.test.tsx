import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HowToPlay } from "./HowToPlay";

describe("HowToPlay", () => {
  it("renders instructions collapsed by default", () => {
    const html = renderToStaticMarkup(<HowToPlay instructions="Score your best attempt." />);
    expect(html).toContain("How to play");
    expect(html).toContain("Score your best attempt.");
    expect(html).toMatch(/^<details[^>]*><summary>/);
    expect(html).not.toContain(" open");
  });

  it("omits the disclosure when instructions are blank", () => {
    expect(renderToStaticMarkup(<HowToPlay instructions={"  \n "} />)).toBe("");
  });
});

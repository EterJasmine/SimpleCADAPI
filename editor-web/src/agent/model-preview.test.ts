import { describe, expect, it } from "vitest";

import { previewFromStl } from "./model-preview";

function triangle(corners: number[]) {
  const buffer = new ArrayBuffer(134);
  const view = new DataView(buffer);
  view.setUint32(80, 1, true);
  view.setFloat32(92, 1, true);
  for (const [i, coordinate] of corners.entries()) view.setFloat32(96 + 4 * i, coordinate, true);
  return buffer;
}

describe("Agent STL preview", () => {
  it("maps CAD millimetres to the editor preview's Y-up metres", () => {
    const preview = previewFromStl(triangle([0, 0, 10, 100, 0, 10, 0, 60, 10]), "version", "底板");
    const part = preview.parts.get("version")!;
    [0, 0.01, 0, 0.1, 0.01, 0, 0, 0.01, -0.06].forEach((value, i) => {
      expect(part.positions[i]).toBeCloseTo(value, 8);
    });
    expect([...part.indices]).toEqual([0, 1, 2]);
    expect(part.edgeIndices).toHaveLength(6);
    expect(part.normals[1]).toBeCloseTo(1);
    expect(preview.nodes[0].partKey).toBe("version");
  });

  it("rejects non-finite coordinates instead of framing a corrupt mesh", () => {
    expect(() => previewFromStl(triangle([NaN, 0, 0, 1, 0, 0, 0, 1, 0]), "bad", "坏模型")).toThrow("STL 中没有有效的三角网格");
  });
});

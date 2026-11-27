import { EdgesGeometry } from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

import type { PreviewData, PreviewNode, PreviewPart } from "@/lib/preview";
import { CAD_TO_GLTF } from "@/scene/cad-three";

const identity: PreviewNode["transform"] = {
  origin: [0, 0, 0], x_axis: [1, 0, 0], y_axis: [0, 1, 0], z_axis: [0, 0, 1],
};

export function previewFromStl(buffer: ArrayBuffer, id: string, name: string): PreviewData {
  const geometry = new STLLoader().parse(buffer);
  let edges: EdgesGeometry | undefined;
  try {
    // STL is CAD Z-up in millimetres. The renderer's preview input is glTF Y-up in metres.
    const positions = geometry.getAttribute("position").array as Float32Array;
    const normals = geometry.getAttribute("normal").array as Float32Array;
    if (!positions.length || positions.length % 9 || !positions.every(Number.isFinite)
      || normals.length !== positions.length || !normals.every(Number.isFinite)) {
      throw new Error("STL 中没有有效的三角网格");
    }
    // EdgesGeometry hashes coordinates with a fixed precision. Detect the edges
    // at the STL's millimetre scale so small parts don't lose their outlines.
    edges = new EdgesGeometry(geometry, 25);
    geometry.applyMatrix4(CAD_TO_GLTF);
    edges.applyMatrix4(CAD_TO_GLTF);
    const edgePositions = edges.getAttribute("position").array as Float32Array;
    const indices = Uint32Array.from({ length: positions.length / 3 }, (_, index) => index);
    const part: PreviewPart = {
      key: id, definitionId: id, positions, normals, indices, edgePositions,
      edgeIndices: Uint32Array.from({ length: edgePositions.length / 3 }, (_, index) => index),
      vertexPositions: new Float32Array(), vertexIds: [], faceGroups: [], edgeGroups: [], solidEntityId: id,
    };
    return {
      parts: new Map([[id, part]]), missing: [],
      nodes: [{ nodeId: id, partKey: id, definitionId: id, displayName: name, transform: identity, color: [0.27, 0.48, 0.78] }],
    };
  } finally {
    edges?.dispose();
    geometry.dispose();
  }
}

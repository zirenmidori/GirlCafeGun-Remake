// Runs the Live2D Cubism Core for one model and posts back its meshes in the default pose.
// One worker per model: when the runtime hangs or crashes on a model file, the page ends the worker and stays usable.
"use strict";
importScripts("/vendor/live2dcubismcore.min.js");
onmessage = e => {
  try {
    const core = self.Live2DCubismCore;
    const moc = core.Moc.fromArrayBuffer(e.data.moc);
    if (!moc) throw new Error("the runtime rejected the moc3 file");
    const model = core.Model.fromMoc(moc);
    if (!model) throw new Error("the runtime could not build the model");
    // several models rest with closed eyes; the game opens them (eye blink controller), so do the same
    const par = model.parameters;
    for (let i = 0; i < par.count; i++) {
      if (/^PARAM_EYE_[LR]_OPEN$/i.test(par.ids[i]) || /^ParamEye[LR]Open$/.test(par.ids[i])) par.values[i] = Math.min(par.maximumValues[i], 1);
    }
    model.update();
    const dr = model.drawables, ci = model.canvasinfo;
    const out = {
      ok: true,
      canvas: {w: ci.CanvasWidth, h: ci.CanvasHeight, ox: ci.CanvasOriginX, oy: ci.CanvasOriginY, ppu: ci.PixelsPerUnit},
      count: dr.count,
      constantFlags: Array.from(dr.constantFlags), dynamicFlags: Array.from(dr.dynamicFlags),
      textureIndices: Array.from(dr.textureIndices), renderOrders: Array.from(dr.renderOrders),
      opacities: Array.from(dr.opacities), maskCounts: Array.from(dr.maskCounts),
      masks: dr.masks.map(m => Array.from(m || [])),
      positions: dr.vertexPositions.map(a => new Float32Array(a)),
      uvs: dr.vertexUvs.map(a => new Float32Array(a)),
      indices: dr.indices.map(a => new Uint16Array(a)),
    };
    postMessage(out);
  } catch (err) {
    postMessage({ok: false, error: String(err && err.message || err)});
  }
};

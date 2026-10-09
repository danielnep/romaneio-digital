/* Tratamento único de placas antigas e Mercosul. */
(function (root) {
  const core = typeof module === "object" && module.exports ? require("./ocr-core.js") : root.RomaneioOcrCore;
  const candidates = text => core.plateCandidates(text).map(c => c.value);
  function normalizeBrazilPlate(value) {
    const exact = core.compact(value);
    return core.validPlate(exact) ? exact : value;
  }
  if (typeof module === "object" && module.exports) module.exports = { candidates, normalizeBrazilPlate };
  else { root.plateCandidates = candidates; root.normalizeBrazilPlate = normalizeBrazilPlate; }
})(typeof globalThis !== "undefined" ? globalThis : this);


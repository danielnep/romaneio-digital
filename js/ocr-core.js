(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RomaneioOcrCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const TO_LETTER = { 0: "O", 1: "I", 2: "Z", 5: "S", 6: "G", 7: "T", 8: "B" };
  const TO_NUMBER = { O: "0", Q: "0", D: "0", I: "1", L: "1", Z: "2", S: "5", G: "6", T: "7", B: "8" };
  const OLD = /^[A-Z]{3}\d{4}$/, MERCOSUL = /^[A-Z]{3}\d[A-Z]\d{2}$/;
  function normalize(text) { return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase(); }
  const compact = text => normalize(text).replace(/[^A-Z0-9]/g, "");
  function validPlate(value) { return OLD.test(value) || MERCOSUL.test(value); }
  function repairPlate(value, type) {
    const chars = value.split(""); let changes = 0;
    const letters = type === "Mercosul" ? [0, 1, 2, 4] : [0, 1, 2];
    for (let i = 0; i < chars.length; i++) {
      const replacement = letters.includes(i) ? TO_LETTER[chars[i]] : TO_NUMBER[chars[i]];
      const expected = letters.includes(i) ? /[A-Z]/ : /\d/;
      if (!expected.test(chars[i]) && replacement) { chars[i] = replacement; changes++; }
    }
    const repaired = chars.join("");
    return changes <= 1 && validPlate(repaired) ? { value: repaired, changes, type } : null;
  }
  function flatWords(data) {
    if (Array.isArray(data?.words)) return data.words;
    return (data?.blocks || []).flatMap(b => (b.paragraphs || []).flatMap(p => (p.lines || []).flatMap(l => l.words || [])));
  }
  function bounds(words) {
    const boxes = words.map(w => w.bbox).filter(Boolean);
    if (!boxes.length) return null;
    return { x0: Math.min(...boxes.map(b => b.x0)), y0: Math.min(...boxes.map(b => b.y0)), x1: Math.max(...boxes.map(b => b.x1)), y1: Math.max(...boxes.map(b => b.y1)) };
  }
  function plateCandidates(input) {
    const data = typeof input === "string" ? { text: input } : input || {};
    const words = flatWords(data), found = [];
    for (const line of normalize(data.text).split(/\r?\n/)) {
      const chunks = line.match(/\b[A-Z0-9]{3}[ ._-]*[A-Z0-9][ ._-]*[A-Z0-9][ ._-]*[A-Z0-9]{2}\b/g) || [];
      for (const chunk of chunks) {
        const raw = compact(chunk);
        if (raw.length !== 7 || !/[A-Z]/.test(raw) || !/\d/.test(raw)) continue;
        const matching = words.filter(w => { const token = compact(w.text); return token.length >= 2 && (raw.includes(token) || token === raw); });
        const confidences = matching.map(w => Number(w.confidence)).filter(Number.isFinite);
        const confidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : Number(data.confidence);
        const common = { raw, confidence: Number.isFinite(confidence) ? Math.round(confidence) : null, bbox: bounds(matching) };
        if (validPlate(raw)) {
          found.push({ ...common, value: raw, type: OLD.test(raw) ? "Antiga" : "Mercosul", changes: 0, exact: true });
          continue; // Uma correspondência válida nunca é convertida para o outro padrão.
        }
        for (const type of ["Antiga", "Mercosul"]) {
          const repaired = repairPlate(raw, type);
          if (repaired) found.push({ ...common, ...repaired, exact: false });
        }
      }
    }
    const unique = new Map();
    for (const candidate of found) {
      candidate.score = (candidate.exact ? 100 : 65) + (candidate.confidence || 0) / 10;
      const previous = unique.get(candidate.value);
      if (!previous || candidate.score > previous.score) unique.set(candidate.value, candidate);
    }
    return [...unique.values()].sort((a, b) => b.score - a.score);
  }
  function combinePlates(frames) {
    const pool = new Map();
    for (const frame of frames) for (const candidate of plateCandidates(frame)) {
      const previous = pool.get(candidate.value);
      if (!previous) pool.set(candidate.value, { ...candidate, support: 1 });
      else pool.set(candidate.value, { ...(candidate.score > previous.score ? candidate : previous), support: previous.support + 1 });
    }
    const candidates = [...pool.values()].sort((a, b) => (b.score + b.support * 2) - (a.score + a.support * 2));
    const best = candidates[0], other = candidates[1];
    const ambiguous = Boolean(other && other.score >= best.score - 5 && other.support >= best.support);
    const selected = best?.exact && best.confidence >= 45 && !ambiguous ? best.value : "";
    return { selected, candidates, needsConfirmation: Boolean(best && !selected) };
  }
  const OTHER_LABEL = /\b(?:CPF|FILIACAO|NASCIMENTO|VALIDADE|EXPEDICAO|CATEGORIA|ASSINATURA|RENACH|NOME|REGISTRO|IDENTIDADE|NATURALIDADE)\b/;
  const NAME_LABEL = /\bNOME(?:\s+E\s+SOBRENOME|\s+COMPLETO)?\s*[:\-]?\s*/;
  const RG_LABEL = /\b(?:RG|REGISTRO\s+GERAL|DOC\.?\s*(?:UMENTO\s*)?(?:DE\s*)?IDENTIDADE)\b\s*[:\-]?\s*/;
  const CNH_LABEL = /(?:\b(?:N[Oº°.]?\s*(?:DE\s*)?REGISTRO|NUMERO\s*(?:DE\s*)?REGISTRO|REGISTRO\s*(?:DA\s*)?CNH)\b|^\s*CNH\s*[:\-])\s*[:\-]?\s*/;
  function parseName(value) {
    const cleaned = normalize(value).replace(/^[\s:.-]+|[\s:.-]+$/g, ""), words = cleaned.split(/\s+/);
    if (words.length < 2 || words.length > 9 || cleaned.length < 6 || !/^[A-Z '\-]+$/.test(cleaned) || OTHER_LABEL.test(cleaned)) return "";
    return cleaned;
  }
  function parseRG(value) {
    if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(value)) return "";
    const match = normalize(value).match(/^\s*([A-Z]{2}[- ]?)?(\d[\d. -]{5,14}[\dX])(?:\s|$)/);
    if (!match) return "";
    const number = match[2].replace(/[^0-9X]/g, "");
    return number.length >= 7 && number.length <= 10 ? (match[1] || "").replace(/[^A-Z]/g, "") + number : "";
  }
  function parseCNH(value) {
    if (/\bCPF\b/.test(normalize(value))) return "";
    const match = String(value).trim().match(/^(\d[\d. -]{9,15}\d)(?:\s|$)/);
    if (!match) return "";
    const number = match[1].replace(/\D/g, "");
    return number.length === 11 ? number : "";
  }
  function extractField(lines, label, parser, confidence) {
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(label);
      if (!match) continue;
      const same = lines[i].slice(match.index + match[0].length).trim(), boundary = same.search(OTHER_LABEL);
      const sameValue = boundary >= 0 ? same.slice(0, boundary).trim() : same;
      if (sameValue) {
        const value = parser(sameValue);
        if (value) return { value, confidence, source: "mesma linha do rótulo", label: match[0].trim() };
      }
      for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
        const nextBoundary = lines[j].search(OTHER_LABEL);
        const value = parser(nextBoundary >= 0 ? lines[j].slice(0, nextBoundary).trim() : lines[j]);
        if (value) return { value, confidence, source: "abaixo do rótulo", label: match[0].trim() };
        if (nextBoundary >= 0) break;
      }
    }
    return null;
  }
  function documentFields(input) {
    const data = typeof input === "string" ? { text: input } : input || {};
    const lines = normalize(data.text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const confidence = Number.isFinite(Number(data.confidence)) ? Math.round(Number(data.confidence)) : null;
    const fields = { motorista: extractField(lines, NAME_LABEL, parseName, confidence), rg: extractField(lines, RG_LABEL, parseRG, confidence), cnh: extractField(lines, CNH_LABEL, parseCNH, confidence) };
    const words = flatWords(data);
    for (const detail of Object.values(fields).filter(Boolean)) {
      const tokens = normalize(detail.value).split(/\s+/).map(compact).filter(t => t.length >= 3);
      const matched = words.filter(w => { const value = compact(w.text); return value.length >= 3 && tokens.some(t => t === value || t.includes(value)); });
      const values = matched.map(w => Number(w.confidence)).filter(Number.isFinite);
      if (values.length) { detail.confidence = Math.round(Math.min(...values)); detail.bbox = bounds(matched); }
    }
    return fields;
  }
  function combineDocuments(frames) {
    const fields = { motorista: null, rg: null, cnh: null }, conflicts = [];
    for (const frame of frames) {
      const parsed = documentFields(frame);
      for (const key of Object.keys(fields)) {
        const next = parsed[key];
        if (!next || conflicts.some(c => c.field === key)) continue;
        const current = fields[key];
        if (current && current.value !== next.value) { conflicts.push({ field: key, values: [current.value, next.value] }); fields[key] = null; continue; }
        if (!current || (next.confidence || 0) > (current.confidence || 0)) fields[key] = next;
      }
    }
    const count = Object.values(fields).filter(Boolean).length;
    return { fields, conflicts, count, complete: Boolean(fields.motorista && (fields.rg || fields.cnh)) };
  }
  return { normalize, compact, validPlate, plateCandidates, combinePlates, documentFields, combineDocuments, flatWords, bounds };
});

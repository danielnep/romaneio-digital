const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../js/ocr-core.js");
const plates = require("../js/placas.js");

test("placa antiga correta não vira Mercosul", () => {
  assert.deepEqual(plates.candidates("ABC1234"), ["ABC1234"]);
  assert.equal(plates.normalizeBrazilPlate("ABC-1234"), "ABC1234");
});
test("Mercosul correta não vira placa antiga", () => {
  assert.deepEqual(plates.candidates("ABC1D23"), ["ABC1D23"]);
});
test("correção sugerida exige confirmação", () => {
  const result = core.combinePlates([{ text: "ABC I234", confidence: 90 }]);
  assert.equal(result.candidates[0].value, "ABC1234");
  assert.equal(result.selected, ""); assert.equal(result.needsConfirmation, true);
});
test("ruído e números longos não viram placas", () => {
  for (const text of ["BRASIL2026", "BRASIL0", "12345678909", "MINISTERIO", "ABC12345"]) assert.deepEqual(plates.candidates(text), []);
});
test("duas placas com a mesma evidência exigem escolha", () => {
  const result = core.combinePlates([{ text: "ABC1234 ABC1D23", confidence: 90 }]);
  assert.equal(result.selected, ""); assert.equal(result.candidates.length, 2);
});
test("baixa confiança não preenche automaticamente", () => {
  assert.equal(core.combinePlates([{ text: "ABC1234", confidence: 20 }]).selected, "");
  assert.equal(core.combinePlates([{ text: "ABC1234", confidence: 90 }]).selected, "ABC1234");
});
test("CPF isolado não preenche CNH", () => {
  const fields = core.documentFields("CARTEIRA NACIONAL DE HABILITACAO\nCPF\n12345678909");
  assert.equal(fields.cnh, null); assert.equal(fields.rg, null);
});
test("nome do motorista não é substituído pelo nome maior da filiação", () => {
  const fields = core.documentFields("NOME\nJOAO DA SILVA\nFILIACAO\nJOSE ANTONIO GONCALVES PEREIRA");
  assert.equal(fields.motorista.value, "JOAO DA SILVA");
});
test("campos completos são extraídos dos respectivos rótulos", () => {
  const fields = core.documentFields("NOME E SOBRENOME\nJOAO DA SILVA\nDOC IDENTIDADE\nMG12345678 SSP MG\nCPF\n12345678909\n5 N REGISTRO\n98765432109");
  assert.equal(fields.motorista.value, "JOAO DA SILVA");
  assert.equal(fields.rg.value, "MG12345678"); assert.equal(fields.cnh.value, "98765432109");
});
test("valores na mesma linha também são reconhecidos", () => {
  const fields = core.documentFields("NOME: JOAO DA SILVA\nRG: 12.345.678-X\nCNH: 98765432109");
  assert.equal(fields.motorista.value, "JOAO DA SILVA"); assert.equal(fields.rg.value, "12345678X"); assert.equal(fields.cnh.value, "98765432109");
});
test("rótulo vizinho interrompe busca por um valor ausente", () => {
  const fields = core.documentFields("N REGISTRO\nCPF\n12345678909\nNOME\nFILIACAO\nJOSE ANTONIO DA SILVA");
  assert.equal(fields.cnh, null); assert.equal(fields.motorista, null);
});
test("conflitos entre tentativas não escolhem um documento arbitrariamente", () => {
  const result = core.combineDocuments([{ text: "NOME JOAO DA SILVA", confidence: 90 }, { text: "NOME MARIA DA SILVA", confidence: 95 }, { text: "NOME JOAO DA SILVA", confidence: 90 }]);
  assert.equal(result.fields.motorista, null); assert.equal(result.conflicts.length, 1);
});
test("documento parcial é distinguido de completo", () => {
  assert.equal(core.combineDocuments([{ text: "NOME JOAO DA SILVA", confidence: 90 }]).complete, false);
  assert.equal(core.combineDocuments([{ text: "NOME JOAO DA SILVA\nRG MG12345678", confidence: 90 }]).complete, true);
});
test("palavras com coordenadas mantêm a área real da placa", () => {
  const result = core.plateCandidates({ text: "ABC1234", confidence: 70, words: [{ text: "ABC1234", confidence: 92, bbox: { x0: 10, y0: 20, x1: 250, y1: 70 } }] });
  assert.equal(result[0].confidence, 92); assert.equal(result[0].bbox.x1, 250);
});
test("campos na mesma linha param antes do rótulo vizinho", () => {
  const fields = core.documentFields("NOME JOAO DA SILVA CPF 12345678909\nN REGISTRO 98765432109 CPF 12345678909");
  assert.equal(fields.motorista.value, "JOAO DA SILVA"); assert.equal(fields.cnh.value, "98765432109");
});
test("baixa confiança nas palavras não é escondida pela média do documento", () => {
  const fields = core.documentFields({ text: "NOME JOAO DA SILVA", confidence: 95, words: [{ text: "JOAO", confidence: 32 }, { text: "SILVA", confidence: 91 }] });
  assert.equal(fields.motorista.confidence, 32);
});

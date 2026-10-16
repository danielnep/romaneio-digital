"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

function harness() {
  const storage = new Map(), nodes = new Map();
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  };
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      id, value: "", checked: false, disabled: false, textContent: "",
      innerHTML: "", style: {}, dataset: {},
      classList: { contains: () => id === "viewEntry", add() {}, remove() {}, toggle() {} },
      addEventListener() {}, replaceChildren() {},
      querySelector: () => ({ focus() {} }), setAttribute() {}, focus() {}
    });
    return nodes.get(id);
  }
  const document = { getElementById: node, addEventListener() {}, querySelectorAll: () => [], readyState: "loading" };
  const window = { addEventListener() {} };
  const navigator = { onLine: true };
  const RomaneioOcrCore = {
    compact: x => String(x).toUpperCase().replace(/[^A-Z0-9]/g, ""),
    validPlate: x => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(x)
  };
  const sessionStorage={getItem:()=>null,setItem(){}},location={origin:"http://localhost:8080",hostname:"localhost"};
  const crypto={randomUUID:()=>"fd97c91f-3234-45bc-9a3f-4c893cc49db1"};
  const context = { window, document, navigator, localStorage, sessionStorage, location, crypto, URL, RomaneioOcrCore, setInterval() {}, setTimeout() {}, clearTimeout() {}, scrollTo() {}, performance: { now: () => 10 } };
  vm.runInNewContext(read("js/app.js") + "\nglobalThis._test={state,CONFIG,readDraft,saveDraft,updateEntryButton,updateExitSaveButton};", context);
  return { ...context, node, storage, api: context._test };
}

test("JavaScript principal e OCR carregam sem erro de sintaxe", () => {
  new vm.Script(read("js/app.js"));
  new vm.Script(read("js/ocr-logs.js"));
});

test("rascunho de atendimento ativo pode ser restaurado", () => {
  const { node, api } = harness();
  node("portaria").value = "P1";
  node("tipoVeiculo").value = "Veículo Pequeno";
  node("tipoAcesso").value = "terceiro";
  node("empresa").value = "Empresa Teste";
  node("placaBau").value = "ABC1234";
  node("motorista").value = "Motorista Teste";
  node("materiais").value = "Ferramentas";
  node("chkVistoria").checked = true;
  api.state.active = true;
  api.state.activeId = "local-test";
  api.saveDraft();
  const saved = api.readDraft();
  assert.equal(saved.activeId, "local-test");
  assert.equal(saved.values.placaBau, "ABC1234");
  assert.equal(saved.vistoria, true);
  assert.equal(saved.version, 2);
});

test("saída manual associa entrada pela placa do cavalo", () => {
  const { node, storage, api } = harness();
  storage.set("rd_patio", JSON.stringify([{ idLocal: "entrada1", portaria: "P1", placaBau: "ABC1234", placaCavalo: "XYZ1A23" }]));
  node("portaria").value = "P1";
  node("exitManual").value = "true";
  node("manualPlate").value = "XYZ1A23";
  node("chkVistoriaSaida").checked = true;
  api.updateExitSaveButton();
  assert.equal(api.state.exitContext.idLocal, "entrada1");
  assert.equal(node("btnSaveExit").disabled, false);
});

test("saída manual sem vínculo precisa de autorização específica", () => {
  const { node, api } = harness();
  node("portaria").value = "P1";
  node("exitManual").value = "true";
  node("manualPlate").value = "DEF1G23";
  node("chkVistoriaSaida").checked = true;
  api.updateExitSaveButton();
  assert.equal(node("btnSaveExit").disabled, true);
  node("chkOrphanExit").checked = true;
  api.updateExitSaveButton();
  assert.equal(node("btnSaveExit").disabled, false);
});

test("diagnósticos e exports OCR não expõem texto ou documentos reconhecidos", () => {
  const m = new Map();
  const localStorage = {
    getItem: k => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
  const window = {};
  vm.runInNewContext(read("js/ocr-logs.js"), {
    window, localStorage,
    document: { readyState: "loading", addEventListener() {} },
    performance: { now: () => 12 },
    setTimeout: () => 1, clearTimeout() {}
  });
  window.OCRLogs.add(null, "texto", "Reconhecimento concluído", {
    texto: "NOME JOAO DA SILVA RG 12345678",
    placa: "ABC1234",
    fields: { motorista: { value: "JOAO DA SILVA" } }
  });
  const exported = window.OCRLogs.serialize();
  for (const secret of ["JOAO DA SILVA", "ABC1234", "12345678"]) {
    assert.equal(exported.includes(secret), false);
  }
});

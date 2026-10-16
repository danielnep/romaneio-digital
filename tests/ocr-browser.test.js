const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright") : "playwright");
const root = path.resolve(__dirname, ".."), fixture = name => path.join(__dirname, "fixtures", name);
const qa = process.env.ROMANEIO_QA_DIR || path.join(root, "..", "tmp", "qa_romaneio");
fs.mkdirSync(qa, { recursive: true });
const server = http.createServer((request, response) => {
  const resource = path.resolve(root, "." + new URL(request.url, "http://localhost").pathname);
  const file = resource === root ? path.join(root, "index.html") : resource;
  if (!file.startsWith(root + path.sep)) { response.writeHead(403); return response.end(); }
  try {
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
    response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }); response.end(fs.readFileSync(file));
  } catch { response.writeHead(404); response.end(); }
});
let browser, page, context;
const results = [], errors = [], payloads = [], network = [];
function success(name, details) { results.push({ name, ...details }); console.log("PASS", name, JSON.stringify(details || {})); }
async function waitReading() { await page.waitForFunction(() => !RomaneioOCR.busy && !state.ocrBusy, null, { timeout: 120000 }); }
async function begin() {
  await page.click("#btnGatewayStart"); await page.click("#btnNovo"); await page.click("#modalConfirm");
  await page.waitForSelector("#viewEntry.active"); await page.fill("#empresa", "EMPRESA DE TESTE"); await page.selectOption("#tipoVeiculo", "Veículo Pequeno");
}
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true, executablePath: process.env.ROMANEIO_CHROME_BIN || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"] });
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: "America/Sao_Paulo", ignoreHTTPSErrors: true, geolocation: { latitude: -20.14, longitude: -44.89 }, permissions: ["geolocation", "clipboard-read", "clipboard-write"] });
  await context.addInitScript(() => { localStorage.setItem("rd_onboarding_done", "true"); });
  // Mesmo SDK/modelo remoto, transportado pelo Node para o navegador de teste.
  // O motor e o reconhecimento continuam reais; nenhum resultado OCR é simulado.
  await context.route(/^https:\/\/(cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com|unpkg\.com)\//, async route => {
    const response = await fetch(route.request().url(), { signal: AbortSignal.timeout(45000) });
    const body = Buffer.from(await response.arrayBuffer()); network.push({ url: route.request().url(), status: response.status, bytes: body.length, contentType: response.headers.get("content-type") });
    await route.fulfill({ status: response.status, body, contentType: response.headers.get("content-type") || "application/octet-stream", headers: { "access-control-allow-origin": "*" } });
  });
  await context.route("**/script.google.com/**", async route => { payloads.push(Object.fromEntries(new URLSearchParams(route.request().postData() || ""))); await route.fulfill({ status: 200, body: "ok", headers: { "access-control-allow-origin": "*" } }); });
  page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://127.0.0.1:" + server.address().port + "/", { waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => typeof window.Tesseract?.createWorker), "function", "SDK indisponível: " + JSON.stringify({ errors, network }));
  await page.click("#btnOcrLogs"); assert.match(await page.textContent("#ocrLogList"), /Faça uma leitura/); await page.click("#btnBackOcrLogs");
  success("tela de logs acessível antes do atendimento");
  await begin();
  await page.setInputFiles("#filePlacaBau", fixture("placa-antiga.png"));
  await page.click("#btnLiveOcrLogs"); await waitReading();
  assert.equal(await page.inputValue("#placaBau"), "ABC1234");
  let snapshot = await page.evaluate(() => OCRLogs.snapshot());
  assert(snapshot.events.some(e => e.stage === "texto" && e.details.texto === "[dado protegido]"));
  assert(snapshot.events.some(e => e.stage === "luz"));
  success("Tesseract real lê placa antiga e produz logs", { durationMs: snapshot.events.filter(e => e.stage === "fim").at(-1).ms });
  await page.click("#btnBackOcrLogs");
  assert.equal(await page.isEnabled("#btnEntryNext1"), true); // motorista fica na etapa seguinte.
  await page.setInputFiles("#filePlacaBau", fixture("placa-antiga.png")); await waitReading();
  snapshot = await page.evaluate(() => OCRLogs.snapshot());
  assert(snapshot.events.some(e => e.message === "Worker reutilizado"));
  assert.equal(await page.inputValue("#filePlacaBau"), "");
  success("mesmo arquivo pode ser relido com worker reutilizado");
  await page.setInputFiles("#filePlacaBau", fixture("placa-mercosul.png")); await waitReading();
  assert.equal(await page.inputValue("#placaBau"), "ABC1234"); // leitura divergente não apaga valor anterior.
  await page.locator("#ocrCandidateArea button").filter({ hasText: "ABC1D23" }).click();
  assert.equal(await page.inputValue("#placaBau"), "ABC1D23");
  success("Mercosul lida e divergência resolvida por confirmação");
  await page.setInputFiles("#fileDocumento", fixture("documento.png")); await waitReading();
  await page.waitForSelector("#modalVistoriaCheck");
  assert.equal(await page.inputValue("#motorista"), "JOAO DA SILVA");
  assert.equal(await page.inputValue("#rg"), "MG12345678");
  assert.equal(await page.inputValue("#cnh"), "98765432109");
  assert.equal(await page.isVisible("#modalVistoriaCheck"), true);
  await page.check("#modalVistoriaCheck"); await page.click("#modalVistoriaGo");
  success("documento real após placa: nome, RG, CNH e modal de vistoria");
  await page.click("#btnEntryNext1"); await page.waitForSelector("#stepEntry2.active");
  assert.equal(await page.isEnabled("#motorista"), true); assert.equal(await page.isEnabled("#btnEntryNext2"), false);
  await page.locator("label[for=chkNoMaterials]").click();
  assert.equal(await page.isChecked("#chkNoMaterials"), true);
  assert.equal(await page.inputValue("#materiais"), "Nenhum material encontrado");
  assert.equal(await page.isEditable("#materiais"), false); assert.equal(await page.isEnabled("#btnEntryNext2"), true);
  await page.locator("label[for=chkNoMaterials]").click();
  assert.equal(await page.inputValue("#materiais"), ""); assert.equal(await page.isEditable("#materiais"), true);
  assert.equal(await page.isEnabled("#btnEntryNext2"), false);
  await page.fill("#materiais", "Mochila, documento");
  assert.equal(await page.isEnabled("#btnEntryNext2"), true);
  await page.check("#chkNoMaterials"); await page.uncheck("#chkNoMaterials");
  assert.equal(await page.inputValue("#materiais"), "Mochila, documento");
  await page.locator("label[for=chkNoMaterials]").click();
  await page.screenshot({ path: path.join(qa, "vistoria-materiais-mobile.png"), fullPage: true });
  success("texto de ausência de materiais clicável, dispensa digitação e restaura descrição ao desmarcar");
  await page.click("#btnEntryNext2"); await page.waitForSelector("#stepEntry3.active");
  await page.setInputFiles("#fileSelfie", fixture("placa-antiga.png"));
  await page.waitForFunction(() => !!state.fotoCarimbadaBase64); await page.click("#btnSaveEntry");
  await page.waitForSelector("#viewMain.active");
  const entries = payloads.filter(p => p.tipoRegistro === "Entrada");
  assert.equal(entries.length, 1); assert.equal(entries[0].cnh, "98765432109"); assert.equal(entries[0].modoRegistro, "OCR / App Web");
  assert.equal(entries[0].materiais, "Nenhum material encontrado");
  assert.equal(await page.isChecked("#chkNoMaterials"), false);
  assert.equal(await page.inputValue("#materiais"), "");
  success("fluxo de entrada completo; backend interceptado para não criar registro real");
  const entryPortaria = await page.inputValue("#portaria");
  assert.equal(await page.evaluate(() => getPatio()[0].vigiaEntrada), "Daniel");
  await page.evaluate(() => {
    addPatio({ idLocal: "fixture-truck", portaria: $("portaria").value, tipoVeiculo: "Caminhões & Carretas", placaBau: "XYZ1234", placaCavalo: "DEF2A34", motorista: "Outro motorista", empresa: "Teste", vigiaEntrada: "Carlos" });
    addPatio({ idLocal: "fixture-legacy", portaria: $("portaria").value, tipoVeiculo: "Veículo Pequeno", placaBau: "JKL1234", motorista: "Registro antigo" });
  });
  await page.click("#btnDocas");
  const cards = page.locator(".vehicle-card"); assert.equal(await cards.count(), 3);
  const firstCard = await cards.nth(0).textContent(), truckCard = await cards.nth(1).textContent(), legacyCard = await cards.nth(2).textContent();
  assert.match(firstCard, /Pequeno/); assert.match(firstCard, /ABC1D23/); assert(firstCard.includes(entryPortaria)); assert.match(firstCard, /Vigia da entrada\s*Daniel/);
  assert.match(truckCard, /Grande/); assert.match(truckCard, /DEF2A34/); assert.match(truckCard, /Vigia da entrada\s*Carlos/);
  assert.match(legacyCard, /Vigia da entrada\s*Não registrado/);
  await page.screenshot({ path: path.join(qa, "saidas-mobile.png"), fullPage: true });
  await cards.nth(0).getByRole("button", { name: "Liberar saída" }).click(); await page.click("#modalConfirm");
  await page.waitForSelector("#modalVistoriaCheck"); await page.check("#modalVistoriaCheck"); await page.click("#modalVistoriaGo");
  const exitSummary = await page.textContent("#exitSummary");
  assert.match(exitSummary, /Pequeno/); assert.match(exitSummary, /ABC1D23/); assert(exitSummary.includes(entryPortaria)); assert.match(exitSummary, /Vigia da entrada\s*Daniel/);
  await page.click("#btnSaveExit"); await page.waitForSelector("#viewDocks.active");
  const exit = payloads.find(p => p.tipoRegistro === "Saida"); assert.equal(exit.vigiaEntrada, "Daniel"); assert.equal(exit.porteVeiculo, "Pequeno");
  await page.evaluate(() => { removePatio("fixture-truck"); removePatio("fixture-legacy"); });
  await page.click("#btnBackMainDocks");
  success("saídas mostram porte, placas, portaria e responsável original; envio mantém o vigia da entrada");
  await page.click("#btnOcrLogs");
  await page.locator("#ocrLogList details").first().evaluate(element => element.open = true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(qa, "ocr-logs-mobile.png"), fullPage: true });
  const downloadPromise = page.waitForEvent("download"); await page.click("#btnExportOcrLogs"); const download = await downloadPromise;
  await download.saveAs(path.join(qa, "ocr-export.json"));
  const exported = JSON.parse(fs.readFileSync(path.join(qa, "ocr-export.json"), "utf8"));
  assert(exported.events.some(e => e.stage === "texto")); assert.equal(JSON.stringify(exported).includes("98765432109"), false);
  await page.click("#btnCopyOcrLogs"); const copied = await page.evaluate(() => navigator.clipboard.readText()); assert.equal(JSON.parse(copied).version, 1);
  await page.selectOption("#ocrLogLevel", "success"); assert(await page.locator(".ocr-log-success").count() > 0); assert.equal(await page.locator(".ocr-log-info").count(), 0);
  await page.selectOption("#ocrLogLevel", "all");
  await page.waitForTimeout(250); await page.reload({ waitUntil: "networkidle" }); await page.click("#btnOcrLogs");
  assert(await page.locator(".ocr-log-event").count() > 0);
  success("logs: detalhes, exportação, cópia, filtros e persistência");
  await page.click("#btnBackOcrLogs"); await begin();
  await page.setInputFiles("#fileDocumento", { name: "invalida.png", mimeType: "image/png", buffer: Buffer.from("arquivo quebrado") }); await waitReading();
  assert(await page.isVisible("#manualEscapeArea"));
  assert((await page.evaluate(() => OCRLogs.snapshot())).events.some(e => e.level === "error" && e.details?.codigo === "INVALID_IMAGE"));
  await page.click("#btnManualEscape"); await page.click("#confirmManual");
  assert.equal(await page.isEnabled("#btnEntryNext1"), true);
  await page.click("#btnEntryNext1");
  assert.equal(await page.isEnabled("#btnEntryNext2"), false);
  success("imagem inválida aparece nos logs e modo manual chega à etapa de preenchimento");
  const controlled = await page.evaluate(async () => {
    RomaneioOCR.cancel();
    const original = Tesseract.createWorker; Tesseract.createWorker = () => new Promise(() => {});
    let code;
    try { const response = await fetch("/tests/fixtures/placa-antiga.png"); await RomaneioOCR.read(new File([await response.blob()], "timeout.png", { type: "image/png" }), "placa", "placaBau", { timeoutMs: 50 }); }
    catch (err) { code = err.code; }
    finally { Tesseract.createWorker = original; }
    return { code, busy: RomaneioOCR.busy };
  });
  assert.equal(controlled.code, "TIMEOUT"); assert.equal(controlled.busy, false);
  success("timeout controlado libera o motor e fica registrado");
  const cancelled = await page.evaluate(async () => {
    RomaneioOCR.cancel();
    const original = Tesseract.createWorker; Tesseract.createWorker = () => new Promise(() => {});
    const response = await fetch("/tests/fixtures/placa-antiga.png");
    const pending = RomaneioOCR.read(new File([await response.blob()], "cancelada.png", { type: "image/png" }), "placa", "placaBau");
    setTimeout(() => RomaneioOCR.cancel(), 30);
    let code; const started = performance.now();
    try { await pending; } catch (err) { code = err.code; } finally { Tesseract.createWorker = original; }
    return { code, elapsed: performance.now() - started, busy: RomaneioOCR.busy };
  });
  assert.equal(cancelled.code, "CANCELLED"); assert.equal(cancelled.busy, false); assert(cancelled.elapsed < 1000);
  success("cancelamento interrompe inicialização pendente sem esperar o timeout");
  await page.setInputFiles("#filePlacaBau", fixture("placa-antiga.png")); await waitReading();
  assert.equal(await page.inputValue("#placaBau"), "ABC1234");
  success("nova leitura real funciona após timeout");
  await page.click("#btnEntryBack2"); await page.selectOption("#tipoVeiculo", "Caminhões & Carretas");
  await page.selectOption("#ocrPlateTarget", "placaCavalo");
  await page.setInputFiles("#filePlacaBau", fixture("placa-mercosul.png")); await waitReading();
  assert.equal(await page.inputValue("#placaCavalo"), "ABC1D23"); assert.equal(await page.inputValue("#placaBau"), "ABC1234");
  assert.equal(await page.evaluate(() => state.ocrPlateSuccess), true);
  success("placa do cavalo recebe sua leitura sem sobrescrever a do baú");
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(qa, "results.json"), JSON.stringify({ results, errors, externalBackendIntercepted: true }, null, 2));
})().catch(async err => {
  console.error("FAIL", err.stack);
  if (page) {
    try { const log = await page.evaluate(() => OCRLogs.snapshot()); fs.writeFileSync(path.join(qa, "failure-logs.json"), JSON.stringify(log, null, 2)); console.error(JSON.stringify(log.events.slice(-8), null, 2)); await page.screenshot({ path: path.join(qa, "failure.png"), fullPage: true }); } catch {}
  }
  process.exitCode = 1;
}).finally(async () => { if (browser) await browser.close(); server.close(); });

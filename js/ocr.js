(function (root) {
  "use strict";
  const core = root.RomaneioOcrCore, logs = root.OCRLogs;
  let worker = null, initializing = null, generation = 0, busy = false, active = null;
  const version = "5.1.1";
  function error(message, code) { const err = new Error(message); err.code = code; return err; }
  function assertActive(run) { if (run.cancelled) throw error("Leitura cancelada.", "CANCELLED"); }
  function deadline(promise, ms, onTimeout, message) {
    let timer;
    const pending = [promise, new Promise((_, reject) => { timer = setTimeout(() => { onTimeout(); reject(error(message, "TIMEOUT")); }, ms); })];
    if (active?.cancellation) pending.push(active.cancellation);
    return Promise.race(pending).finally(() => clearTimeout(timer));
  }
  function dispose() {
    generation++; const previous = worker; worker = null; initializing = null;
    if (previous) Promise.resolve(previous.terminate()).catch(err => logs.add(active, "worker", "Falha ao encerrar worker", { error: err.message }, "warn"));
  }
  function cancel() {
    if (active) { active.cancelled = true; active.cancelReject?.(error("Leitura cancelada.", "CANCELLED")); logs.add(active, "cancelamento", "Cancelamento solicitado", null, "warn"); }
    dispose();
  }
  const statusLabels = {
    "loading tesseract core": "Carregando motor WASM",
    "initializing tesseract": "Inicializando motor OCR",
    "loading language traineddata": "Carregando idioma português",
    "initializing api": "Preparando reconhecimento",
    "recognizing text": "Reconhecendo texto"
  };
  async function getWorker(run, timeout) {
    if (!root.Tesseract) throw error("Biblioteca OCR não carregou. Confira a conexão e tente novamente.", "LIBRARY_UNAVAILABLE");
    if (worker) { logs.add(run, "worker", "Worker reutilizado"); return worker; }
    if (!initializing) {
      const currentGeneration = generation;
      logs.add(run, "worker", "Inicializando Tesseract.js", { version, language: "por", mode: "LSTM", workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@" + version + "/dist/worker.min.js", corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@" + version });
      initializing = root.Tesseract.createWorker("por", 1, {
        workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@" + version + "/dist/worker.min.js",
        corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@" + version,
        logger(message) {
          if (!active || active.cancelled || currentGeneration !== generation) return;
          const label = statusLabels[message.status] || message.status || "Processando";
          if (active.lastStatus !== message.status) { logs.add(active, "motor", label, { status: message.status }); active.lastStatus = message.status; }
          const progress = message.status === "recognizing text" ? 15 + ((active.pass || 0) + (message.progress || 0)) * 25 : (message.progress || 0) * 12;
          logs.progress(active, label, progress);
        },
        errorHandler(err) { if (active && currentGeneration === generation) logs.add(active, "motor", "Erro do motor OCR", { error: String(err?.message || err) }, "error"); }
      }).then(created => {
        if (currentGeneration !== generation || run.cancelled) { created.terminate().catch(() => {}); throw error("Inicialização cancelada.", "CANCELLED"); }
        worker = created; return created;
      });
    }
    try { return await deadline(initializing, timeout, dispose, "O motor OCR demorou demais para carregar. Tente novamente."); }
    finally { initializing = null; }
  }
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(error("Não foi possível abrir esta imagem. Use uma foto JPG ou PNG.", "INVALID_IMAGE")); };
      image.src = url;
    });
  }
  function canvasFrom(image, max = 2000) {
    const ratio = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height); return canvas;
  }
  function metrics(canvas) {
    const sample = document.createElement("canvas"), ratio = Math.min(160 / canvas.width, 160 / canvas.height);
    sample.width = Math.max(1, Math.round(canvas.width * ratio)); sample.height = Math.max(1, Math.round(canvas.height * ratio));
    const context = sample.getContext("2d", { willReadFrequently: true }); context.drawImage(canvas, 0, 0, sample.width, sample.height);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    let sum = 0, squares = 0, whites = 0, blacks = 0;
    for (let i = 0; i < pixels.length; i += 4) { const luminance = pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722; sum += luminance; squares += luminance * luminance; if (luminance >= 245) whites++; if (luminance <= 20) blacks++; }
    const count = pixels.length / 4, average = sum / count;
    return { luminanciaMedia: Math.round(average), contrasteMedido: Math.round(Math.sqrt(Math.max(0, squares / count - average * average))), pixelsMuitoClarosPercentual: Math.round(whites / count * 100), pixelsEscurosPercentual: Math.round(blacks / count * 100), perfil: "dia • sem aumento artificial de brilho" };
  }
  function crop(canvas, box) {
    if (!box) return null;
    const width = box.x1 - box.x0, height = box.y1 - box.y0;
    if (width < 10 || height < 5) return null;
    const marginX = Math.max(12, width * .08), marginY = Math.max(12, height * .35);
    const x = Math.max(0, Math.floor(box.x0 - marginX)), y = Math.max(0, Math.floor(box.y0 - marginY));
    const w = Math.min(canvas.width - x, Math.ceil(width + marginX * 2)), h = Math.min(canvas.height - y, Math.ceil(height + marginY * 2));
    const output = document.createElement("canvas"); output.width = w; output.height = h;
    output.getContext("2d").drawImage(canvas, x, y, w, h, 0, 0, w, h);
    return { canvas: output, region: { x, y, width: w, height: h } };
  }
  function enhance(canvas, kind, gray, contrast) {
    const scale = Math.min(kind === "placa" ? 2.5 : 1.3, 2200 / Math.max(canvas.width, canvas.height));
    const output = document.createElement("canvas"); output.width = Math.max(1, Math.round(canvas.width * scale)); output.height = Math.max(1, Math.round(canvas.height * scale));
    const context = output.getContext("2d"); context.filter = (gray ? "grayscale(100%) " : "") + "contrast(" + contrast + ")";
    context.drawImage(canvas, 0, 0, output.width, output.height); return output;
  }
  async function read(file, kind, target, options = {}) {
    if (busy) throw error("Já existe uma leitura em andamento.", "BUSY");
    busy = true;
    const run = logs.start(kind, target, { arquivo: file?.name || "", tipo: file?.type || "", bytes: file?.size || 0, perfil: "fotos durante o dia" });
    run.cancellation = new Promise((_, reject) => { run.cancelReject = reject; });
    active = run;
    const started = performance.now(), budget = options.timeoutMs || 90000;
    const remaining = () => Math.max(1, budget - (performance.now() - started));
    try {
      if (!file || !(/^image\//.test(file.type) || (!file.type && /\.(jpg|jpeg|png|webp|bmp)$/i.test(file.name)))) throw error("Selecione um arquivo de imagem.", "INVALID_IMAGE");
      if (file.size > 20 * 1024 * 1024) throw error("A imagem é muito grande. Use uma foto de até 20 MB.", "IMAGE_TOO_LARGE");
      const image = await deadline(loadImage(file), Math.min(remaining(), 15000), () => { run.cancelled = true; }, "Não foi possível abrir a imagem a tempo.");
      assertActive(run);
      const full = canvasFrom(image, kind === "documento" ? 2200 : 2000);
      logs.add(run, "imagem", "Imagem aberta e dimensionada", { original: { width: image.naturalWidth, height: image.naturalHeight }, processada: { width: full.width, height: full.height }, orientacao: "decodificação do navegador" });
      const light = metrics(full); logs.add(run, "luz", "Luz e contraste da foto avaliados", light);
      if (light.contrasteMedido < 18) logs.add(run, "qualidade", "Pouco contraste: confira foco e reflexos na foto.", null, "warn");
      const instance = await getWorker(run, Math.min(remaining(), 45000)); assertActive(run);
      const frames = [];
      let source = full, cropped = false, result;
      for (let pass = 0; pass < 3; pass++) {
        assertActive(run); run.pass = pass;
        const psm = pass === 0 ? 11 : kind === "placa" && cropped ? 7 : pass === 1 ? 6 : 11;
        const variant = pass === 0 ? full : enhance(source, kind, pass === 1, pass === 1 ? 1.15 : 1);
        await instance.setParameters({ tessedit_pageseg_mode: String(psm), tessedit_char_whitelist: kind === "placa" ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" : "", preserve_interword_spaces: "1" });
        logs.add(run, "tentativa", "Tentativa " + (pass + 1) + (pass === 0 ? " • imagem original" : pass === 1 ? " • cinza e contraste leve" : " • cores preservadas"), { psm, width: variant.width, height: variant.height, recortada: cropped, whitelist: kind === "placa" ? "letras e números" : "livre" });
        const recognized = await deadline(instance.recognize(variant, {}, { text: true, blocks: true }), Math.min(remaining(), 35000), () => { run.cancelled = true; dispose(); }, "O reconhecimento demorou demais. Tente uma foto mais próxima.");
        assertActive(run);
        const data = recognized.data || {};
        frames.push(data);
        logs.add(run, "texto", "Texto reconhecido • tentativa " + (pass + 1), { texto: data.text || "", confianca: Math.round(data.confidence || 0), palavras: core.flatWords(data).length });
        result = kind === "placa" ? core.combinePlates(frames) : core.combineDocuments(frames);
        logs.add(run, "extracao", kind === "placa" ? "Candidatos de placa avaliados" : "Campos do documento avaliados", result, result.needsConfirmation || result.conflicts?.length ? "warn" : "info");
        const confident = kind === "placa" ? result.selected && result.candidates[0].confidence >= 75 : result.complete && Object.values(result.fields).filter(Boolean).every(f => f.confidence >= 70);
        if (confident) { logs.add(run, "decisao", "Resultado suficiente; novas tentativas dispensadas"); break; }
        if (pass === 0) {
          const box = kind === "placa" ? core.plateCandidates(data)[0]?.bbox : core.bounds(core.flatWords(data));
          const selection = crop(full, box);
          if (selection) { source = selection.canvas; cropped = true; logs.add(run, "recorte", "Área útil localizada para a próxima tentativa", selection.region); }
          else logs.add(run, "recorte", "Sem área confiável para recorte; mantendo a imagem inteira", null, "warn");
        }
      }
      assertActive(run);
      return { ...result, run, frames, durationMs: Math.round(performance.now() - started) };
    } catch (err) {
      dispose();
      logs.finish(run, err.code === "CANCELLED" ? "Leitura cancelada" : "Falha na leitura", { codigo: err.code || "OCR_ERROR", mensagem: err.message, stack: String(err.stack || "").split("\n").slice(0, 6).join("\n") }, err.code === "CANCELLED" ? "warn" : "error");
      err.ocrLogged = true; err.run = run; throw err;
    } finally { if (active === run) active = null; busy = false; }
  }
  root.RomaneioOCR = { read, cancel, version, get busy() { return busy; } };
})(window);

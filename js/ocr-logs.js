(function (root) {
  "use strict";
  const KEY = "rd_ocr_logs_v1", LIMIT = 300;
  let events = [], live = null, returnView = "viewMain", persistTimer = null, renderedKey = "";
  try { const saved = JSON.parse(localStorage.getItem(KEY) || "[]"); if (Array.isArray(saved)) events = saved.filter(e => e && e.id && e.stage && e.at).slice(-LIMIT).map(e=>({...e,details:safeDetails(e.details)})); } catch { /* Histórico inválido não impede a operação. */ }
  const listeners = new Set();
  const labels = { documento: "Documento", placa: "Placa", sistema: "Sistema" };
  const el = id => document.getElementById(id);
  function notify() { listeners.forEach(fn => fn()); }
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(events)); } catch { if (el("ocrLogStorage")) el("ocrLogStorage").textContent = "Histórico apenas nesta sessão: armazenamento do aparelho indisponível."; } }, 100);
  }
  function safeDetails(value) {
    if (value === null || value === undefined) return null;
    // Remover dados pessoais ANTES da persistência, exibição, cópia e exportação.
    const sensitive=/^(texto|text|raw|valor|value|placa|motorista|nome|rg|cnh|documento|anterior|novaLeitura)$/i;
    function mask(item,key="") {
      if(typeof item==="string"){
        if(sensitive.test(key))return "[dado protegido]";
        return item.replace(/\b[A-Z]{3}[- ]?[0-9][A-Z0-9][0-9]{2}\b/gi,"[placa protegida]").replace(/\b[0-9]{7,14}\b/g,"[número protegido]").slice(0,10000);
      }
      if(Array.isArray(item))return item.map(x=>mask(x));
      if(item&&typeof item==="object")return Object.fromEntries(Object.entries(item).map(([k,v])=>[k,mask(v,k)]));
      return item;
    }
    return mask(value);
  }
  function add(run, stage, message, details = null, level = "info") {
    const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), runId: run?.id || "sistema", kind: run?.kind || "sistema", target: run?.target || "", at: new Date().toISOString(), ms: run ? Math.round(performance.now() - run.started) : 0, stage, message, level, details: safeDetails(details) };
    events.push(item); events = events.slice(-LIMIT); persist(); notify(); return item;
  }
  function start(kind, target, details) {
    const run = { id: Date.now().toString(36), kind, target, started: performance.now() };
    live = { runId: run.id, kind, target, status: "Preparando imagem", progress: 0, running: true };
    add(run, "inicio", "Leitura iniciada • foto diurna", details);
    return run;
  }
  function progress(run, status, percentage) {
    live = { runId: run.id, kind: run.kind, target: run.target, status, progress: Math.max(0, Math.min(100, Math.round(percentage || 0))), running: true };
    notify();
  }
  function finish(run, status, details, level = "success") {
    live = { runId: run.id, kind: run.kind, target: run.target, status, progress: 100, running: false };
    add(run, "fim", status, details, level);
  }
  function snapshot() { return { version: 1, exportedAt: new Date().toISOString(), mode: "fotos diurnas", live, events: events.slice() }; }
  function serialize() { return JSON.stringify(snapshot(), null, 2); }
  function open() {
    const current = document.querySelector(".view.active");
    if (current?.id !== "viewOcrLogs") returnView = current?.id || "viewMain";
    if (el("overlay")?.dataset.ocrLoading === "true") root.closeOverlay?.();
    root.showView("viewOcrLogs"); render();
  }
  function render() {
    if (!el("viewOcrLogs")?.classList.contains("active")) return;
    const status = el("ocrLogLive");
    status.textContent = live ? labels[live.kind] + " • " + live.status : "Nenhuma leitura nesta sessão.";
    el("ocrLogProgress").style.width = (live?.progress || 0) + "%";
    el("ocrLogProgressWrap").classList.toggle("hidden", !live?.running);
    el("btnClearOcrLogs").disabled = Boolean(live?.running);
    const kind = el("ocrLogKind").value, level = el("ocrLogLevel").value;
    const filtered = events.filter(e => (kind === "all" || e.kind === kind) && (level === "all" || e.level === level));
    el("ocrLogCount").textContent = filtered.length + " de " + events.length + " eventos";
    const key = kind + ":" + level + ":" + events.length + ":" + (events.at(-1)?.id || "");
    if (key === renderedKey) return;
    renderedKey = key;
    const list = el("ocrLogList"), opened = new Set([...list.querySelectorAll("details[open]")].map(d => d.dataset.eventId));
    list.replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement("div"); empty.className = "empty";
      empty.textContent = events.length ? "Nenhum evento para este filtro." : "Faça uma leitura de placa ou documento. As etapas aparecerão aqui.";
      list.append(empty); return;
    }
    for (const item of filtered.slice().reverse()) {
      const card = document.createElement("article"); card.className = "ocr-log-event ocr-log-" + item.level;
      const meta = document.createElement("div"); meta.className = "ocr-log-meta";
      const badge = document.createElement("span"); badge.className = "ocr-log-badge"; badge.textContent = labels[item.kind] || "Sistema";
      const time = document.createElement("time"); time.dateTime = item.at; time.textContent = new Date(item.at).toLocaleTimeString("pt-BR") + " • " + (item.ms / 1000).toFixed(1) + "s";
      meta.append(badge, time);
      const title = document.createElement("strong"); title.textContent = item.message;
      const step = document.createElement("small"); step.className = "ocr-log-stage"; step.textContent = item.stage + (item.target ? " • " + item.target : "") + " • leitura " + item.runId;
      card.append(meta, title, step);
      if (item.details) {
        const details = document.createElement("details"); details.dataset.eventId = item.id; details.open = opened.has(item.id);
        const summary = document.createElement("summary"); summary.textContent = "Ver detalhes";
        const content = document.createElement("pre"); content.textContent = JSON.stringify(item.details, null, 2);
        details.append(summary, content); card.append(details);
      }
      list.append(card);
    }
  }
  function boot() {
    persist(); // Substitui registros legados não mascarados por versões protegidas.
    el("btnOcrLogs").onclick = open;
    el("btnEntryOcrLogs").onclick = open;
    el("btnBackOcrLogs").onclick = () => root.showView(returnView);
    el("ocrLogKind").onchange = render; el("ocrLogLevel").onchange = render;
    el("btnClearOcrLogs").onclick = () => { events = []; persist(); render(); root.toast("Histórico do OCR limpo."); };
    el("btnExportOcrLogs").onclick = () => {
      const url = URL.createObjectURL(new Blob([serialize()], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "romaneio-ocr-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    el("btnCopyOcrLogs").onclick = async () => {
      try { await navigator.clipboard.writeText(serialize()); root.toast("Logs copiados."); }
      catch { root.toast("Não foi possível copiar. Use Exportar JSON."); }
    };
    listeners.add(render);
  }
  root.OCRLogs = { start, add, progress, finish, snapshot, serialize, open };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})(window);

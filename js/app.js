const CONFIG={vigia:(localStorage.getItem("rd_vigia")||"Daniel"),dbName:"RomaneioDigitalDB",dbVersion:1,queueStore:"fila",eventStore:"eventos"};
const state={online:navigator.onLine,active:false,activeId:null,watchId:null,lastPosition:null,battery:null,manualUnlocked:false,ocrDocumentAttempted:false,ocrPlateAttempted:false,ocrDocumentSuccess:false,ocrPlateSuccess:false,fotoCarimbadaBase64:"",selfieTakenAt:null,db:null,ocrBusy:false,ocrEpoch:0,ocrManualUsed:false,ocrResults:{},ocrNextTarget:null,ocrRun:null,ocrManuallyEdited:false,materialsBeforeNone:"",pageHiddenAt:null,exitContext:null,onboarding:{slide:Number(localStorage.getItem("rd_onboarding_slide")||1),done:localStorage.getItem("rd_onboarding_done")==="true",logs:JSON.parse(localStorage.getItem("rd_onboarding_logs")||"{}")}};
const $=id=>document.getElementById(id),now=()=>new Date(),human=()=>{const d=now();return{data:d.toLocaleDateString("pt-BR"),hora:d.toLocaleTimeString("pt-BR"),iso:d.toISOString()}};
function toast(msg,ms=2800){const el=$("toast");el.textContent=msg;el.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),ms)}
function vibrar(p=30){try{navigator.vibrate?.(p)}catch{}}
function showView(id){document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));$(id).classList.add("active");scrollTo({top:0,behavior:"instant"})}
function openOverlay(html,type="normal"){delete $("overlay").dataset.ocrLoading;const box=$("overlayBox");box.className="modal"+(type==="danger"?" modal-danger":"");$("overlayBody").innerHTML=html;$("overlay").classList.add("show");$("overlay").setAttribute("aria-hidden","false");box.querySelector("textarea,input:not([disabled]),button:not([disabled])")?.focus()}
function closeOverlay(){$("overlay").classList.remove("show");$("overlay").setAttribute("aria-hidden","true")}
function setLoading(title,text="Processando..."){openOverlay(`<div class="loading-center"><div class="spinner"></div><h3>${title}</h3><p>${text}</p></div>`)}
function updateClock(){const d=now();$("topClock").textContent=d.toLocaleTimeString("pt-BR");$("topStatus").textContent=state.active?(state.online?"ATENDIMENTO • ONLINE":"ATENDIMENTO • OFFLINE"):(state.online?"ONLINE":"OFFLINE");$("mainMonitorStatus").textContent=state.active?(state.online?"Monitoramento ativo":"Monitoramento ativo • sem rede"):"Monitoramento inativo"}
setInterval(updateClock,1000);updateClock();
async function openDB(){return new Promise((resolve,reject)=>{if(state.db)return resolve(state.db);const req=indexedDB.open(CONFIG.dbName,CONFIG.dbVersion);req.onupgradeneeded=e=>{const db=e.target.result;if(!db.objectStoreNames.contains(CONFIG.queueStore))db.createObjectStore(CONFIG.queueStore,{keyPath:"id",autoIncrement:true});if(!db.objectStoreNames.contains(CONFIG.eventStore))db.createObjectStore(CONFIG.eventStore,{keyPath:"id",autoIncrement:true})};req.onsuccess=e=>{state.db=e.target.result;resolve(state.db)};req.onerror=()=>reject(req.error)})}
async function queuePayload(payload,kind="registro"){const operationId=crypto.randomUUID().replaceAll("-",""),db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(CONFIG.queueStore,"readwrite");tx.objectStore(CONFIG.queueStore).add({payload,kind,operationId,status:"pending",createdAt:now().toISOString()});tx.oncomplete=()=>resolve(operationId);tx.onerror=()=>reject(tx.error)})}
async function getQueue(){const db=await openDB();return new Promise((resolve,reject)=>{const r=db.transaction(CONFIG.queueStore,"readonly").objectStore(CONFIG.queueStore).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error)})}
async function updateQueueOperationId(item){const operationId=crypto.randomUUID().replaceAll("-"),db=await openDB();await new Promise((resolve,reject)=>{const tx=db.transaction(CONFIG.queueStore,"readwrite"),store=tx.objectStore(CONFIG.queueStore),r=store.get(item.id);r.onsuccess=()=>{if(r.result&&!r.result.operationId)store.put({...r.result,operationId})};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});return operationId}
async function removeQueue(id){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(CONFIG.queueStore,"readwrite");tx.objectStore(CONFIG.queueStore).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
async function logEventLocal(name,data={}){try{const db=await openDB();db.transaction(CONFIG.eventStore,"readwrite").objectStore(CONFIG.eventStore).add({eventName:name,data,at:now().toISOString()})}catch{}}
function serverBase(){const stored=localStorage.getItem("rd_server_url")||"";return stored?stored.replace(/\/$/,""):location.hostname.endsWith(".github.io")?"":location.origin}
async function probeServer(base,token){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch(base+"/api/status",{headers:{"Authorization":"Bearer "+token},signal:controller.signal});
    const data=await response.json().catch(()=>null);
    if(!response.ok||data?.ok!==true||data.storage!=="sqlite")throw new Error("Servidor não confirmou disponibilidade do banco.");
  }finally{clearTimeout(timeout)}
}
function syncToken(){return sessionStorage.getItem("rd_sync_token")||""}
function syncReady(){return Boolean(serverBase()&&syncToken())}
function syncState(message){if($("serverSyncStatus"))$("serverSyncStatus").textContent=message}
async function serverRequest(item){
  if(!syncReady())throw new Error("Servidor não configurado ou chave de sessão ausente.");
  const url=serverBase()+"/api/records";
  if(!/^https:\/\//.test(url)&&!/^http:\/\/localhost[:/]/.test(url)&&!/^http:\/\/127\.0\.0\.1[:/]/.test(url))throw new Error("Servidor sem HTTPS.");
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+syncToken()},body:JSON.stringify({operationId:item.operationId,payload:item.payload}),signal:controller.signal});
    const receipt=await response.json().catch(()=>null);
    if(!response.ok||!receipt||receipt.ok!==true||receipt.confirmed!==true||receipt.operationId!==item.operationId||!receipt.persistedAt)throw new Error("Servidor não confirmou a gravação (HTTP "+response.status+").");
    return receipt;
  }finally{clearTimeout(timeout)}
}
async function postPayload(payload,{silent=false}={}){
  const operationId=await queuePayload(payload);
  if(navigator.onLine&&syncReady())await syncQueue();
  const confirmed=!(await getQueue()).some(row=>row.operationId===operationId);
  if(!silent)toast(confirmed?"Gravado no servidor.":"Salvo no dispositivo; sincronização pendente.");
  updateMainKPIs();return {queued:!confirmed,confirmed,operationId};
}
async function refreshPatioFromServer(){
  if(!navigator.onLine||!syncReady())return false;
  const url=serverBase()+"/api/patio?portaria="+encodeURIComponent($("portaria").value);
  const response=await fetch(url,{headers:{"Authorization":"Bearer "+syncToken()},signal:AbortSignal.timeout(15000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok||data?.ok!==true||!Array.isArray(data.vehicles))throw new Error("Pátio remoto indisponível.");
  const portaria=$("portaria").value,local=getPatio().filter(v=>v.portaria!==portaria);
  const byId=new Map(data.vehicles.map(v=>[String(v.idLocal),v]));
  for(const entry of await getQueue()){
    if(entry.status==="sent_unverified"||!entry.payload||entry.payload.portaria!==portaria)continue;
    const v=entry.payload;
    if(v.tipoRegistro==="Entrada")byId.set(String(v.idLocal),{idLocal:v.idLocal,portaria:v.portaria,empresa:v.empresa,tipoVeiculo:v.tipoVeiculo,placaBau:v.placaBau,placaCavalo:v.placaCavalo,motorista:v.motorista,vigiaEntrada:v.vigiaEntrada,porteVeiculo:v.porteVeiculo,horaAtual:v.horaAtual,dataAtual:v.dataAtual});
    if(v.tipoRegistro==="Saida"){
      if(v.idLocal)byId.delete(String(v.idLocal));
      else for(const [id,vehicle] of byId)if(vehicle.placaBau===v.placaBau||vehicle.placaCavalo===v.placaBau){byId.delete(id);break}
    }
  }
  setPatio([...local,...byId.values()]);
  return true;
}
let syncingQueue=false;
async function syncQueue(){
  if(syncingQueue||!navigator.onLine||!syncReady())return;
  syncingQueue=true;
  try{
    for(const item of await getQueue()){
      if(item.status==="sent_unverified")continue;
      try{
        const operationId=item.operationId||await updateQueueOperationId(item);
        const receipt=await serverRequest({...item,operationId});
        await removeQueue(item.id);
        localStorage.setItem("rd_last_sync",receipt.persistedAt);
      }catch(error){syncState("Sincronização pendente: "+error.message);break}
    }
    if(!(await getQueue()).some(v=>v.status!=="sent_unverified"))syncState("Todos os registros novos foram confirmados pelo servidor.");
    try{await refreshPatioFromServer()}catch{syncState("Envio verificado; atualização do pátio remoto pendente.")}
  }catch(e){syncState("Falha local: "+e.message)}
  finally{syncingQueue=false;updateMainKPIs()}
}
window.addEventListener("online",()=>{state.online=true;updateClock();toast("Conexão restabelecida. Sincronizando...");syncQueue()});window.addEventListener("offline",()=>{state.online=false;updateClock();if(state.active)recordAnomaly("NETWORK_LOST","Perda de conexão durante atendimento",false)});setInterval(syncQueue,30000);
function getPatio(){try{const v=JSON.parse(localStorage.getItem("rd_patio")||"[]");return Array.isArray(v)?v:[]}catch{return []}}function setPatio(v){localStorage.setItem("rd_patio",JSON.stringify(v));updateMainKPIs()}function addPatio(v){setPatio([...getPatio(),v])}function removePatio(id){setPatio(getPatio().filter(v=>v.idLocal!==id))}
async function updateMainKPIs(){try{const port=$("portaria").value;$("kpiPatio").textContent=getPatio().filter(v=>v.portaria===port).length;const queue=await getQueue();$("kpiFila").textContent=queue.filter(v=>v.status!=="sent_unverified").length;$("kpiUnverified").textContent=queue.filter(v=>v.status==="sent_unverified").length}catch{syncState("Armazenamento indisponível. Não finalize registros neste aparelho.")}}
function currentGps(){return state.lastPosition?`${state.lastPosition.coords.latitude}, ${state.lastPosition.coords.longitude}`:""}
function setGpsBadge(status){const el=$("entryGpsBadge");if(el){el.textContent=status;el.dataset.status=status==="GPS atualizado"?"ok":"warn"}}
function getFreshGps(){return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>{state.lastPosition=p;setGpsBadge("GPS atualizado");resolve(p)},error=>{setGpsBadge("GPS indisponível");reject(error)},{enableHighAccuracy:true,timeout:15000,maximumAge:1000}))}
async function startMonitoring(){state.active=true;state.activeId=state.activeId||Date.now().toString();updateClock();if(!navigator.geolocation)throw new Error("GPS indisponível");await getFreshGps();state.watchId=navigator.geolocation.watchPosition(p=>{state.lastPosition=p;setGpsBadge("GPS atualizado")},()=>{setGpsBadge("GPS sem atualização");recordAnomaly("GPS_LOST","Perda de atualização de localização",true)},{enableHighAccuracy:true,maximumAge:2500,timeout:15000});if(navigator.getBattery)navigator.getBattery().then(b=>state.battery=b).catch(()=>{})}
function stopMonitoring(){if(state.watchId!==null){navigator.geolocation.clearWatch(state.watchId);state.watchId=null}state.active=false;state.lastPosition=null;state.activeId=null;setGpsBadge("GPS inativo");updateClock()}
async function recordAnomaly(type,details,critical=true){if(!state.active)return;const p={tipoRegistro:"ALERTA_ANOMALIA",idLocal:state.activeId||"",portaria:$("portaria").value,vigia:CONFIG.vigia,event:type,detalhes:details,localizacao:currentGps(),dataAtual:human().data,horaAtual:human().hora,critico:critical?"SIM":"NAO"};await logEventLocal(type,p);await postPayload(p,{silent:true});if(critical)toast("Anomalia registrada para averiguação.")}
document.addEventListener("visibilitychange",()=>{if(!state.active)return;if(document.hidden)state.pageHiddenAt=Date.now();else if(state.pageHiddenAt){const s=Math.round((Date.now()-state.pageHiddenAt)/1000);state.pageHiddenAt=null;if(s>=10)recordAnomaly("APP_BACKGROUND",`Aplicativo ficou em segundo plano por ${s}s`,false)}});
function saveOnboarding(){localStorage.setItem("rd_onboarding_slide",String(state.onboarding.slide));localStorage.setItem("rd_onboarding_done",String(state.onboarding.done));localStorage.setItem("rd_onboarding_logs",JSON.stringify(state.onboarding.logs))}
function showOnboardSlide(n){state.onboarding.slide=n;[1,2,3].forEach(i=>$("onboard"+i).classList.toggle("active",i===n));[1,2,3].forEach(i=>$("obp"+i).classList.toggle("active",i<=n));saveOnboarding()}
async function acceptSlide(n){state.onboarding.logs[`slide${n}`]=human().iso;await logEventLocal("ONBOARDING_ACCEPTED",{step:n});saveOnboarding()}
$("btnGatewayStart").onclick=()=>{if(state.onboarding.done){showView("viewMain");updateMainKPIs();offerDraft()}else{showView("viewOnboarding");showOnboardSlide(Math.min(3,Math.max(1,state.onboarding.slide||1)))}};
$("obNext1").onclick=async()=>{await acceptSlide(1);showOnboardSlide(2)};$("obNext2").onclick=async()=>{await acceptSlide(2);showOnboardSlide(3)};$("obFinalCheck").onchange=e=>$("obFinish").disabled=!e.target.checked;$("obFinish").onclick=async()=>{if(!$("obFinalCheck").checked)return;await acceptSlide(3);state.onboarding.done=true;saveOnboarding();showView("viewMain");updateMainKPIs();offerDraft()};$("btnProtocolo").onclick=()=>showView("viewProtocol");$("btnBackProtocol").onclick=()=>showView("viewMain");$("btnReplayProtocol").onclick=()=>{state.onboarding.done=false;state.onboarding.slide=1;$("obFinalCheck").checked=false;$("obFinish").disabled=true;saveOnboarding();showView("viewOnboarding");showOnboardSlide(1)};
const DRAFT_KEY="rd_entry_draft_v2",DRAFT_FIELDS=["tipoAcesso","empresa","tipoVeiculo","placaBau","placaCavalo","motorista","rg","cnh","ajudantes","materiais","observacoes"];
function readDraft(){try{const d=JSON.parse(localStorage.getItem(DRAFT_KEY)||"null");if(!d||d.version!==2||Date.now()-d.updatedAt>86400000){localStorage.removeItem(DRAFT_KEY);return null}return d}catch{return null}}
function offerDraft(){const d=readDraft();$("resumeDraft").classList.toggle("hidden",!d);if(d)$("resumeDraftAge").textContent="Atendimento interrompido • "+new Date(d.updatedAt).toLocaleString("pt-BR")}
function clearDraft(){localStorage.removeItem(DRAFT_KEY);offerDraft()}
function saveDraft(){
  if(!state.active||!$("viewEntry").classList.contains("active"))return;
  try{
    const values=Object.fromEntries(DRAFT_FIELDS.map(id=>[id,$(id).value]));
    localStorage.setItem(DRAFT_KEY,JSON.stringify({version:2,updatedAt:Date.now(),activeId:state.activeId,portaria:$("portaria").value,values,step:$("stepEntry3").classList.contains("active")?3:$("stepEntry2").classList.contains("active")?2:1,vistoria:$("chkVistoria").checked,noMaterials:$("chkNoMaterials").checked,materialsBeforeNone:state.materialsBeforeNone,manualUnlocked:state.manualUnlocked,ocrDocumentAttempted:state.ocrDocumentAttempted,ocrPlateAttempted:state.ocrPlateAttempted,ocrManualUsed:state.ocrManualUsed,ocrDocumentSuccess:state.ocrDocumentSuccess,ocrPlateSuccess:state.ocrPlateSuccess}));
  }catch{toast("Armazenamento cheio: rascunho não preservado.")}
}
async function resumeDraft(){
  const d=readDraft();if(!d)return offerDraft();
  openCalco(async()=>{
    try{
      setLoading("RETOMANDO ATENDIMENTO","Validando localização...");
      resetEntry();$("portaria").value=d.portaria||"P1";state.activeId=d.activeId||Date.now().toString();
      await startMonitoring();
      $("tipoAcesso").value=d.values.tipoAcesso||"terceiro";$("tipoAcesso").dispatchEvent(new Event("change"));
      state.ocrDocumentAttempted=!!d.ocrDocumentAttempted;state.ocrPlateAttempted=!!d.ocrPlateAttempted;
      state.ocrManualUsed=!!d.ocrManualUsed;state.ocrDocumentSuccess=!!d.ocrDocumentSuccess;state.ocrPlateSuccess=!!d.ocrPlateSuccess;
      if(d.manualUnlocked)unlockEntryFields();
      DRAFT_FIELDS.forEach(id=>{if(d.values[id]!==undefined)$(id).value=d.values[id]});
      updateVehicleTypeFields();$("chkNoMaterials").checked=!!d.noMaterials;
      state.materialsBeforeNone=d.materialsBeforeNone||"";$("materiais").readOnly=!!d.noMaterials;
      $("chkVistoria").checked=!!d.vistoria;$("btnOcrDocumento").disabled=false;$("btnOcrPlaca").disabled=false;
      $("ocrStatus").textContent="Rascunho recuperado. Revise os dados e refaça a selfie.";
      closeOverlay();showView("viewEntry");
      if(d.step>=2){$("stepEntry1").classList.remove("active");$("stepEntry2").classList.add("active");$("entryProgress").style.width="66%"}
      updateEntryButton();
      if(d.step===3&&!$("btnEntryNext2").disabled)$("btnEntryNext2").click();
      toast("Atendimento retomado. Selfie precisa ser refeita.");saveDraft();
    }catch{closeOverlay();stopMonitoring();showView("viewMain");offerDraft();toast("GPS indisponível. Rascunho preservado.")}
  });
}
$("btnResumeDraft").onclick=resumeDraft;
$("entryForm").addEventListener("input",saveDraft);
$("entryForm").addEventListener("change",saveDraft);
$("entryForm").addEventListener("click",e=>{if(e.target.closest(".step-nav button"))queueMicrotask(saveDraft)});
function resetEntry(){if(state.ocrBusy)RomaneioOCR.cancel();state.ocrEpoch++;state.materialsBeforeNone="";$("materiais").readOnly=false;$("chkNoMaterials").disabled=true;state.ocrManualUsed=false;state.ocrManuallyEdited=false;state.ocrResults={};state.ocrRun=null;state.ocrNextTarget=null;$("ocrCandidateArea").replaceChildren();$("ocrPlateTarget").value="placaBau";$("entryForm").reset();state.manualUnlocked=false;state.ocrDocumentAttempted=false;state.ocrPlateAttempted=false;state.ocrDocumentSuccess=false;state.ocrPlateSuccess=false;state.fotoCarimbadaBase64="";state.selfieTakenAt=null;state.ocrBusy=false;$("manualEscapeArea").classList.add("hidden");$("ocrStatus").textContent="Aguardando tentativa de leitura.";["empresa","tipoVeiculo"].forEach(id=>$(id).disabled=false);["placaBau","placaCavalo","motorista","rg","cnh","ajudantes","materiais","observacoes"].forEach(id=>$(id).disabled=true);$("btnEntryNext1").disabled=true;$("btnEntryNext2").disabled=true;$("btnSaveEntry").disabled=true;$("previewCarimbo").style.display="none";$("previewCarimbo").src="";$("stepEntry1").classList.add("active");$("stepEntry2").classList.remove("active");$("stepEntry3").classList.remove("active");$("entryProgress").style.width="33%";$("tipoAcesso").value="terceiro";$("thirdPartyFields").classList.remove("hidden");$("fleetBranch").classList.add("hidden");updateVehicleTypeFields()}
function openCalco(callback){vibrar(25);openOverlay(`<h3>⚠️ Atenção</h3><p>Em conformidade com as normas disponíveis abaixo e para todos, somado à assinatura realizada na folha de termo físico, assumo e confirmo este termo de responsabilidade, garantindo pessoalmente que o veículo está <strong>COMPLETAMENTE PARADO</strong>, com o <strong>MOTOR DESLIGADO</strong> e o <strong>CALÇO NAS RODAS</strong> devidamente posicionado.</p><button id="modalConfirm" type="button" class="btn btn-primary">Confirmar</button><button id="modalCancel" type="button" class="btn btn-ghost">Cancelar Ação</button>`);$("modalConfirm").onclick=()=>{vibrar(60);closeOverlay();callback()};$("modalCancel").onclick=closeOverlay}
function openVistoria(callback,saida=false,onCancel=null){const texto=saida?"📋 VISTORIA OBRIGATÓRIA: confirme a vistoria de saída conforme o procedimento da operação.":($("tipoVeiculo").value==="Veículo Pequeno"?"📋 VISTORIA OBRIGATÓRIA: confirme que vistoriou a FRENTE e a CARGA do veículo.":"📋 VISTORIA OBRIGATÓRIA: confirme que vistoriou APENAS A CABINE do caminhão.");openOverlay(`<h3>${saida?"VISTORIA DE SAÍDA":"VISTORIA DO VEÍCULO"}</h3><p>${texto}</p><label class="check-row"><input id="modalVistoriaCheck" type="checkbox"><span>☑️ CONFIRMO QUE A VISTORIA FOI REALIZADA.</span></label><button id="modalVistoriaGo" type="button" class="btn btn-primary" disabled>Continuar</button><button id="modalVistoriaCancel" type="button" class="btn btn-ghost">Voltar sem confirmar</button>`);$("modalVistoriaCheck").onchange=e=>$("modalVistoriaGo").disabled=!e.target.checked;$("modalVistoriaGo").onclick=()=>{closeOverlay();callback()};$("modalVistoriaCancel").onclick=()=>{closeOverlay();onCancel?.()}}
function resizeCanvas(img,max=2400){const sc=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)),cv=document.createElement("canvas");cv.width=Math.max(1,Math.round(img.naturalWidth*sc));cv.height=Math.max(1,Math.round(img.naturalHeight*sc));cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height);return cv}
function imageFromFile(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=r.result};r.onerror=reject;r.readAsDataURL(file)})}
function setOcrButtonsBusy(busy) {
  ["btnOcrDocumento","btnOcrPlaca","btnOcrDocumentoReview","btnOcrPlacaBauReview","btnOcrPlacaCavaloReview"].forEach(id => $(id).disabled = busy || !state.active);
}
function applyOcrField(id, value, run) {
  if (!value) return false;
  const previous = $(id).value.trim();
  if (previous && previous !== value) {
    OCRLogs.add(run, "conflito", "Valor anterior preservado; nova leitura divergiu", { campo: id, anterior: previous, novaLeitura: value }, "warn");
    return false;
  }
  $(id).value = value;
  OCRLogs.add(run, "preenchimento", "Campo preenchido pelo OCR", { campo: id, valor: value });
  return true;
}
function updateOcrPlateSuccess() {
  state.ocrPlateSuccess = Boolean(state.ocrResults.placaBau && ($("tipoVeiculo").value !== "Caminhões & Carretas" || state.ocrResults.placaCavalo));
}
function showPlateChoices(candidates, target, run) {
  const area = $("ocrCandidateArea"); area.replaceChildren();
  const title = document.createElement("p"); title.textContent = "Confirme a placa lida antes de preencher:";
  area.append(title);
  for (const candidate of candidates.slice(0, 4)) {
    const button = document.createElement("button"); button.type = "button"; button.className = "btn btn-outline";
    button.textContent = candidate.value + " • " + candidate.type + (candidate.exact ? "" : " • correção sugerida");
    button.onclick = () => {
      $(target).value = candidate.value; state.ocrResults[target] = true; updateOcrPlateSuccess();
      OCRLogs.add(run, "confirmacao", "Candidato de placa confirmado pelo operador", { campo: target, placa: candidate.value, alteracoes: candidate.changes }, "success");
      unlockEntryFields(); area.replaceChildren(); $("ocrStatus").textContent = "Placa confirmada: " + candidate.value + ". Revise os dados."; updateEntryButton(); updateEntryDataButton();
    };
    area.append(button);
  }
}
async function processarOcr(file, tipo, requestedTarget) {
  if (!file || state.ocrBusy) return;
  const epoch = state.ocrEpoch, doc = tipo === "documento", target = doc ? "documento" : requestedTarget || $("ocrPlateTarget").value;
  state.ocrBusy = true; if (doc) state.ocrDocumentAttempted = true; else state.ocrPlateAttempted = true;
  $("ocrCandidateArea").replaceChildren(); setOcrButtonsBusy(true); updateEntryButton(); updateEntryDataButton();
  openOverlay('<div class="loading-center"><div class="spinner"></div><h3>LENDO IMAGEM</h3><p>Acompanhe o reconhecimento e cada tentativa na tela de logs.</p><button id="btnLiveOcrLogs" type="button" class="btn btn-outline">Ver logs em tempo real</button><button id="btnStopOcr" type="button" class="btn btn-ghost">Cancelar leitura</button></div>');
  $("overlay").dataset.ocrLoading = "true";
  $("btnLiveOcrLogs").onclick = () => OCRLogs.open(); $("btnStopOcr").onclick = () => RomaneioOCR.cancel();
  let needsVistoria = false;
  try {
    const result = await RomaneioOCR.read(file, tipo, target);
    if (state.ocrEpoch !== epoch) return;
    state.ocrRun = result.run;
    if (doc) {
      let filled = 0;
      for (const [field, detail] of Object.entries(result.fields)) if (detail && detail.confidence >= 45 && applyOcrField(field, detail.value, result.run)) filled++;
      state.ocrDocumentSuccess = Boolean(result.fields.motorista && $("motorista").value === result.fields.motorista.value && ["rg","cnh"].some(field => result.fields[field] && result.fields[field].confidence >= 45 && $(field).value === result.fields[field].value));
      state.ocrResults.documento = state.ocrDocumentSuccess;
      if (filled) {
        unlockEntryFields(); needsVistoria = true;
        $("ocrStatus").textContent = (state.ocrDocumentSuccess ? "Documento lido." : "Documento parcialmente lido.") + " Confira os campos na próxima etapa.";
        OCRLogs.finish(result.run, state.ocrDocumentSuccess ? "Documento identificado; revise os campos" : "Leitura parcial; revisão necessária", { campos: result.fields, conflitos: result.conflicts, tempoMs: result.durationMs }, state.ocrDocumentSuccess ? "success" : "warn");
      } else {
        $("ocrStatus").textContent = "Documento sem dados confiáveis. Veja os logs, tente outra foto ou autorize o preenchimento manual.";
        $("manualEscapeArea").classList.remove("hidden");
        OCRLogs.finish(result.run, "Documento inconclusivo", { campos: result.fields, conflitos: result.conflicts }, "warn");
      }
    } else {
      if (result.selected && applyOcrField(target, result.selected, result.run)) {
        state.ocrResults[target] = true; updateOcrPlateSuccess(); unlockEntryFields();
        $("ocrStatus").textContent = "Placa lida: " + result.selected + ". Confira o resultado.";
        OCRLogs.finish(result.run, "Placa identificada", { campo: target, placa: result.selected, candidatos: result.candidates, tempoMs: result.durationMs });
      } else {
        if (result.candidates.length) showPlateChoices(result.candidates, target, result.run);
        $("manualEscapeArea").classList.remove("hidden");
        $("ocrStatus").textContent = result.candidates.length ? "A leitura precisa de confirmação. Confira os candidatos abaixo." : "Nenhuma placa confiável. Veja os logs e tente uma foto mais próxima ou autorize o modo manual.";
        OCRLogs.finish(result.run, result.candidates.length ? "Placa aguardando confirmação" : "Placa não identificada", { candidatos: result.candidates, campo: target }, "warn");
      }
    }
    vibrar([70,40,70]);
  } catch (err) {
    if (state.ocrEpoch !== epoch) return;
    state.ocrRun = err.run || null;
    if (err.code === "CANCELLED") $("ocrStatus").textContent = "Leitura cancelada. Escolha a imagem para tentar novamente.";
    else { $("ocrStatus").textContent = "Falha na leitura: " + err.message + " Os detalhes estão nos logs."; $("manualEscapeArea").classList.remove("hidden"); toast("Leitura falhou. Veja os logs ou use o modo manual."); }
  } finally {
    if (state.ocrEpoch === epoch) {
      state.ocrBusy = false; setOcrButtonsBusy(false);
      if ($("overlay").dataset.ocrLoading === "true") { closeOverlay(); delete $("overlay").dataset.ocrLoading; }
      updateEntryButton(); updateEntryDataButton();saveDraft();
    }
  }
  if (needsVistoria && state.ocrEpoch === epoch) openVistoria(() => { $("chkVistoria").checked = true; updateEntryDataButton(); OCRLogs.add(state.ocrRun, "vistoria", "Vistoria confirmada pelo operador", null, "success");saveDraft(); });
}
function validEntryData() {
  const core = RomaneioOcrCore, truck = $("tipoVeiculo").value === "Caminhões & Carretas";
  return $("empresa").value.trim().length >= 2 && core.validPlate(core.compact($("placaBau").value)) && $("motorista").value.trim().length >= 2 && (!truck || core.validPlate(core.compact($("placaCavalo").value))) && ($("chkNoMaterials").checked || $("materiais").value.trim().length > 0);
}
function updateEntryDataButton(){
  $("btnEntryNext2").disabled=!(validEntryData()&&$("chkVistoria").checked&&!state.ocrBusy);
  const missing=[],core=RomaneioOcrCore,truck=$("tipoVeiculo").value==="Caminhões & Carretas";
  if(!core.validPlate(core.compact($("placaBau").value)))missing.push("placa do veículo");
  if(truck&&!core.validPlate(core.compact($("placaCavalo").value)))missing.push("placa do cavalo");
  if($("motorista").value.trim().length<2)missing.push("motorista");
  if(!$("chkNoMaterials").checked&&!$("materiais").value.trim())missing.push("materiais ou confirmação de ausência");
  if(!$("chkVistoria").checked)missing.push("confirmação da vistoria");
  $("entryMissingFields").textContent=missing.length?"Para avançar: "+missing.join(", ")+".":"Dados conferidos. Pode avançar.";
}
$("chkNoMaterials").addEventListener("change", event => {
  const field = $("materiais"), checked = event.target.checked;
  if (checked) { state.materialsBeforeNone = field.value; field.value = "Nenhum material encontrado"; }
  else { field.value = state.materialsBeforeNone; state.materialsBeforeNone = ""; }
  field.readOnly = checked;
  OCRLogs.add(state.ocrRun, "vistoria", checked ? "Ausência de materiais confirmada pelo operador" : "Descrição de materiais reaberta", null, checked ? "success" : "info");
  updateEntryDataButton();
});
$("materiais").addEventListener("input", updateEntryDataButton);

function unlockEntryFields(){state.manualUnlocked=true;$("chkNoMaterials").disabled=false;$("materiais").readOnly=$("chkNoMaterials").checked;["empresa","tipoVeiculo","placaBau","placaCavalo","motorista","rg","cnh","ajudantes","materiais","observacoes"].forEach(id=>$(id).disabled=false);updateVehicleTypeFields()}
function updateVehicleTypeFields(){const truck=$("tipoVeiculo").value==="Caminhões & Carretas";$("cavaloWrap").classList.toggle("hidden",!truck);$("placaCavalo").required=truck;$("lblPlacaBau").textContent=truck?"PLACA DO BAÚ / CARRETA *":"PLACA DO VEÍCULO *";$("lblVistoria").textContent=truck?"☑️ CONFIRMO QUE VISTORIEI APENAS A CABINE DO CAMINHÃO.":"☑️ CONFIRMO QUE VISTORIEI A FRENTE E A CARGA DO VEÍCULO.";$("ocrPlateCavaloOption").disabled=!truck;$("btnOcrPlacaCavaloReview").classList.toggle("hidden",!truck);if(!truck&&$("ocrPlateTarget").value==="placaCavalo")$("ocrPlateTarget").value="placaBau";updateOcrPlateSuccess()}
function updateEntryButton(){const attempted=state.ocrDocumentAttempted||state.ocrPlateAttempted;$("btnEntryNext1").disabled=!(state.manualUnlocked&&$("empresa").value.trim().length>=2&&attempted&&!state.ocrBusy);const missing=[];if(!attempted)missing.push("faça uma leitura de documento ou placa");if(!state.manualUnlocked&&attempted)missing.push("confirme a leitura ou libere o modo manual");if($("empresa").value.trim().length<2)missing.push("informe a empresa");$("entryTriagemHint").textContent=missing.length?"Para avançar: "+missing.join("; ")+".":"Triagem pronta para revisão.";updateEntryDataButton()}
["empresa","placaBau","placaCavalo","motorista"].forEach(id=>$(id).addEventListener("input",updateEntryButton));$("tipoVeiculo").addEventListener("change",()=>{$("chkVistoria").checked=false;updateVehicleTypeFields();updateEntryButton()});
$("btnOcrDocumento").onclick=()=>$("fileDocumento").click();$("btnOcrPlaca").onclick=()=>$("filePlacaBau").click();$("fileDocumento").onchange=e=>{const file=e.target.files[0];e.target.value="";processarOcr(file,"documento")};$("filePlacaBau").onchange=e=>{const file=e.target.files[0],target=state.ocrNextTarget||$("ocrPlateTarget").value;e.target.value="";state.ocrNextTarget=null;processarOcr(file,"placa",target)};$("btnOcrDocumentoReview").onclick=()=>$("fileDocumento").click();$("btnOcrPlacaBauReview").onclick=()=>{state.ocrNextTarget="placaBau";$("filePlacaBau").click()};$("btnOcrPlacaCavaloReview").onclick=()=>{state.ocrNextTarget="placaCavalo";$("filePlacaBau").click()};
$("btnManualEscape").onclick=()=>{openOverlay(`<h3>⚠️ MODO MANUAL</h3><p>A tentativa por imagem não produziu dados utilizáveis. O preenchimento manual será liberado e o registro ficará marcado para conferência.</p><button id="confirmManual" type="button" class="btn btn-primary">Ciente e liberar</button>` ,"danger");$("confirmManual").onclick=async()=>{state.ocrManualUsed=true;unlockEntryFields();OCRLogs.add(state.ocrRun,"modo_manual","Modo manual autorizado pelo operador",{idAtendimento:state.activeId},"warn");await logEventLocal("OCR_MANUAL_ENABLED",{idLocal:state.activeId,runId:state.ocrRun?.id||""});closeOverlay();updateEntryButton();toast("Modo manual liberado e registrado.")}};
$("btnNovo").onclick=()=>{resetEntry();openCalco(async()=>{try{setLoading("ATIVANDO ATENDIMENTO","Solicitando localização…");state.activeId=Date.now().toString();await startMonitoring();clearDraft();closeOverlay();$("btnOcrDocumento").disabled=false;$("btnOcrPlaca").disabled=false;showView("viewEntry");$("ocrStatus").textContent="Pronto para leitura. A foto vem primeiro.";updateEntryButton();saveDraft()}catch{closeOverlay();openOverlay(`<h3>GPS NECESSÁRIO</h3><p>Não foi possível obter a localização do aparelho. Autorize o GPS e tente novamente.</p><button id="gpsRetry" class="btn btn-primary" type="button">Tentar novamente</button><button id="gpsCancel" class="btn btn-ghost" type="button">Cancelar</button>`);$("gpsRetry").onclick=()=>{closeOverlay();$("btnNovo").click()};$("gpsCancel").onclick=()=>{closeOverlay();stopMonitoring()}}})};
$("tipoAcesso").onchange=()=>{const fleet=$("tipoAcesso").value==="frota";$("thirdPartyFields").classList.toggle("hidden",fleet);$("fleetBranch").classList.toggle("hidden",!fleet)};$("btnFleetBack").onclick=()=>{$("tipoAcesso").value="terceiro";$("tipoAcesso").dispatchEvent(new Event("change"))};$("btnFleetGate").onclick=async()=>{try{const result=await postPayload({tipoRegistro:"LIBERACAO_FROTA_INTERNA",portaria:$("portaria").value,vigia:CONFIG.vigia,dataAtual:human().data,horaAtual:human().hora},{silent:true});clearDraft();toast(result.queued?"Liberação salva no aparelho; envio pendente.":"Liberação enviada sem confirmação do servidor.")}catch{toast("Não foi possível registrar a liberação. Confira o armazenamento local.")}finally{stopMonitoring();showView("viewMain")}};
$("btnEntryNext1").onclick=()=>{if($("btnEntryNext1").disabled)return;$("stepEntry1").classList.remove("active");$("stepEntry2").classList.add("active");$("entryProgress").style.width="66%"};$("chkVistoria").onchange=updateEntryDataButton;$("btnEntryBack2").onclick=()=>{$("stepEntry2").classList.remove("active");$("stepEntry1").classList.add("active");$("entryProgress").style.width="33%"};$("btnEntryNext2").onclick=()=>{if(!validEntryData())return toast("Confira motorista, placas e materiais antes de avançar.");if(!$('chkVistoria').checked)return toast("A vistoria precisa ser confirmada.");$("sumPortaria").textContent=$("portaria").value;$("sumVeiculo").textContent=$("tipoVeiculo").value;$("sumPlaca").textContent=$("placaBau").value.toUpperCase();$("sumMotorista").textContent=$("motorista").value.toUpperCase();$("stepEntry2").classList.remove("active");$("stepEntry3").classList.add("active");$("entryProgress").style.width="100%"};$("btnEntryBack3").onclick=()=>{$("stepEntry3").classList.remove("active");$("stepEntry2").classList.add("active");$("entryProgress").style.width="66%"};
$("btnSelfie").onclick=()=>$("fileSelfie").click();$("fileSelfie").onchange=e=>gerarCarimbo(e.target.files[0]);async function gerarCarimbo(file){if(!file)return;setLoading("GERANDO CARIMBO","Preparando a selfie de confirmação…");try{const img=await imageFromFile(file),maxW=1000,sc=Math.min(1,maxW/img.naturalWidth),w=Math.round(img.naturalWidth*sc),h=Math.round(img.naturalHeight*sc),cv=$("canvasCarimbo"),pad=145;cv.width=w;cv.height=h+pad;const c=cv.getContext("2d");c.drawImage(img,0,0,w,h);c.fillStyle="rgba(10,12,15,.86)";c.fillRect(0,h,w,pad);const g=currentGps()||"GPS indisponível",n=human(),lines=["ROMANEIO DIGITAL • CONFIRMAÇÃO","VIGIA: "+CONFIG.vigia.toUpperCase(),"EMPRESA: "+$("empresa").value.toUpperCase(),"VEÍCULO: "+$("tipoVeiculo").value.toUpperCase(),"PLACA: "+$("placaBau").value.toUpperCase(),$("placaCavalo").value.trim()?"PLACA CAVALO: "+$("placaCavalo").value.toUpperCase():"","MOTORISTA: "+$("motorista").value.toUpperCase(),"PORTARIA: "+$("portaria").value,"GPS: "+g,"DATA/HORA: "+n.data+" "+n.hora].filter(Boolean);let y=h+20;lines.forEach((line,i)=>{c.font=i===0?"700 14px Arial":"11px Arial";c.fillStyle=i===0?"#d4af37":"#eef0f3";c.fillText(line,16,y);y+=12;i===0&&(y+=4)});state.fotoCarimbadaBase64=cv.toDataURL("image/jpeg",.66);$("previewCarimbo").src=state.fotoCarimbadaBase64;$("previewCarimbo").style.display="block";state.selfieTakenAt=n.iso;$("btnSaveEntry").disabled=false;toast("Selfie carimbada pronta.")}catch{toast("Não foi possível gerar a selfie carimbada.")}finally{closeOverlay()}}
$("entryForm").onsubmit=async e=>{e.preventDefault();if(!validEntryData())return toast("Confira os dados obrigatórios.");if(!$('chkVistoria').checked)return toast("Confirme a vistoria.");if(!state.fotoCarimbadaBase64)return toast("Faça a selfie de confirmação.");await salvarEntrada()};async function salvarEntrada(){try{setLoading("SALVANDO ENTRADA","Registrando a operação…");const gps=await getFreshGps().catch(()=>state.lastPosition),h=human(),obj={idLocal:state.activeId,tipoRegistro:"Entrada",portaria:$("portaria").value,empresa:$("empresa").value.trim(),tipoVeiculo:$("tipoVeiculo").value,placaCavalo:$("placaCavalo").value.trim().toUpperCase(),placaBau:$("placaBau").value.trim().toUpperCase(),motorista:$("motorista").value.trim(),rg:$("rg").value.trim(),cnh:$("cnh").value.trim(),ajudantes:$("ajudantes").value.trim(),materiais:$("chkNoMaterials").checked?"Nenhum material encontrado":$("materiais").value.trim(),vigiaEntrada:CONFIG.vigia,porteVeiculo:vehicleSize({tipoVeiculo:$("tipoVeiculo").value}),localizacao:gps?`${gps.coords.latitude},${gps.coords.longitude}`:currentGps(),observacoes:$("observacoes").value.trim()||"Sem observações",vigia:CONFIG.vigia,dataAtual:h.data,horaAtual:h.hora,calcoConfirmado:"SIM",vistoriaConfirmada:"SIM",modoRegistro:state.ocrManualUsed?"Manual / OCR falhou":state.ocrManuallyEdited?"OCR / dados revisados":state.ocrDocumentSuccess&&state.ocrPlateSuccess?"OCR / App Web":"OCR parcial / revisado",sinal:state.online?"ONLINE":"OFFLINE",fotoValidacao:state.fotoCarimbadaBase64,selfieTakenAt:state.selfieTakenAt||h.iso};const delivery=await postPayload(obj,{silent:true});addPatio({idLocal:obj.idLocal,portaria:obj.portaria,empresa:obj.empresa,tipoVeiculo:obj.tipoVeiculo,placaBau:obj.placaBau,placaCavalo:obj.placaCavalo,motorista:obj.motorista,vigiaEntrada:obj.vigiaEntrada,porteVeiculo:obj.porteVeiculo,horaAtual:obj.horaAtual,dataAtual:obj.dataAtual});stopMonitoring();clearDraft();resetEntry();closeOverlay();showView("viewMain");updateMainKPIs();toast(delivery.queued?"Entrada salva neste aparelho; envio pendente.":"Entrada enviada; confirme o recebimento no servidor.")}catch{closeOverlay();toast("Falha ao salvar. O registro foi preservado para sincronização.")}}
async function cancelActive(stage){openOverlay(`<h3>Cancelar atendimento</h3><p>Informe o motivo para registrar o encerramento normal do atendimento.</p><div class="field"><label for="cancelReason">MOTIVO</label><textarea id="cancelReason"></textarea></div><button id="confirmCancel" type="button" class="btn btn-primary">Cancelar registro</button><button id="cancelCancel" type="button" class="btn btn-ghost">Voltar</button>`);$("confirmCancel").onclick=async()=>{const reason=$("cancelReason").value.trim();if(reason.length<3)return toast("Informe o motivo.");await postPayload({tipoRegistro:"Cancelamento",idLocal:state.activeId||"",portaria:$("portaria").value,vigia:CONFIG.vigia,etapa:stage,motivoCancelamento:reason,dataAtual:human().data,horaAtual:human().hora,localizacao:currentGps()});stopMonitoring();clearDraft();resetEntry();closeOverlay();showView("viewMain");toast("Cancelamento registrado no aparelho.")};$("cancelCancel").onclick=closeOverlay}
["btnCancelEntry1","btnCancelEntry2","btnCancelEntry3"].forEach(id=>$(id).onclick=()=>cancelActive("ENTRADA"));
$("btnDocas").onclick=()=>{renderDocks();showView("viewDocks");refreshPatioFromServer().then(updated=>{if(updated)renderDocks()}).catch(()=>toast("Sem consulta ao servidor. Exibindo dados deste aparelho."))};$("btnBackMainDocks").onclick=()=>showView("viewMain");function escapeHtml(s){return String(s??"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}function vehicleSize(vehicle) {
  if (vehicle.porteVeiculo) return vehicle.porteVeiculo;
  if (vehicle.tipoVeiculo === "Veículo Pequeno") return "Pequeno";
  if (vehicle.tipoVeiculo === "Caminhões & Carretas") return "Grande";
  return "Não informado";
}
function entryGuard(vehicle) { return vehicle.vigiaEntrada || vehicle.vigia || "Não registrado"; }
function vehicleFacts(vehicle) {
  return `<div class="summary-item"><small>Porte do veículo</small><strong>${escapeHtml(vehicleSize(vehicle))}</strong></div>
    <div class="summary-item"><small>Placa do baú / única</small><strong>${escapeHtml(vehicle.placaBau || "-")}</strong></div>
    ${vehicle.placaCavalo ? `<div class="summary-item"><small>Placa do cavalo</small><strong>${escapeHtml(vehicle.placaCavalo)}</strong></div>` : ""}
    <div class="summary-item"><small>Portaria da entrada</small><strong>${escapeHtml(vehicle.portaria || "Não registrada")}</strong></div>
    <div class="summary-item"><small>Vigia da entrada</small><strong>${escapeHtml(entryGuard(vehicle))}</strong></div>`;
}
function renderDocks() {
  const list = getPatio().filter(vehicle => vehicle.portaria === $("portaria").value), container = $("dockList");
  if (!list.length) { container.innerHTML = '<div class="empty">Nenhum veículo aguardando saída nesta portaria.</div>'; return; }
  container.replaceChildren();
  list.forEach(vehicle => {
    const card = document.createElement("div"); card.className = "vehicle-card";
    card.innerHTML = `<div class="vehicle-main">${escapeHtml(vehicle.placaBau || "-")} • ${escapeHtml(vehicle.motorista || "-")}</div>
      <div class="vehicle-meta">${escapeHtml(vehicle.empresa || "")}<br>${escapeHtml(vehicle.tipoVeiculo || "")}</div>
      <div class="summary-grid vehicle-facts">${vehicleFacts(vehicle)}<div class="summary-item"><small>Entrada</small><strong>${escapeHtml([vehicle.dataAtual, vehicle.horaAtual].filter(Boolean).join(" • ") || "-")}</strong></div></div>
      <button class="btn btn-primary" type="button">Liberar saída</button>`;
    card.querySelector("button").onclick = () => openExit(false, vehicle); container.appendChild(card);
  });
}
$("btnManualExit").onclick=()=>openExit(true,null);
async function openExit(manual,vehicle){state.exitContext=vehicle;$("exitManual").value=manual?"true":"false";$("exitId").value=manual?"":(vehicle?.idLocal||"");$("manualExitWrap").classList.toggle("hidden",!manual);$("manualPlate").value="";$("chkOrphanExit").checked=false;$("orphanExitConsent").classList.add("hidden");$("manualExitMatches").textContent="";$("chkVistoriaSaida").checked=false;$("btnSaveExit").disabled=true;$("exitSummary").innerHTML=vehicle?`${vehicleFacts(vehicle)}<div class="summary-item"><small>Empresa</small><strong>${escapeHtml(vehicle.empresa)}</strong></div><div class="summary-item"><small>Motorista</small><strong>${escapeHtml(vehicle.motorista)}</strong></div><div class="summary-item"><small>Entrada</small><strong>${escapeHtml([vehicle.dataAtual,vehicle.horaAtual].filter(Boolean).join(" • "))}</strong></div>`:'<div class="banner">Informe a placa e o sistema tentará localizar a entrada correspondente.</div>';openCalco(async()=>{try{state.activeId=$("exitId").value||Date.now().toString();setLoading("ATIVANDO SAÍDA","Solicitando localização…");await startMonitoring();closeOverlay();openVistoria(()=>{showView("viewExit");$("chkVistoriaSaida").checked=true;updateExitSaveButton()},true,()=>{stopMonitoring();showView("viewDocks");renderDocks()})}catch{closeOverlay();stopMonitoring();toast("GPS obrigatório para registrar a saída.")}})}
function resolveManualExit(){
  if($("exitManual").value!=="true")return;
  const plate=RomaneioOcrCore.compact($("manualPlate").value),valid=RomaneioOcrCore.validPlate(plate);
  const matches=valid?getPatio().filter(v=>v.portaria===$("portaria").value&&(RomaneioOcrCore.compact(v.placaBau||"")===plate||RomaneioOcrCore.compact(v.placaCavalo||"")===plate)):[];
  const label=$("manualExitMatches");state.exitContext=null;$("exitId").value="";
  $("orphanExitConsent").classList.add("hidden");
  if(!valid){label.textContent=plate?"Placa inválida. Confira as sete posições.":"Informe a placa para consultar a entrada local.";$("exitSummary").replaceChildren();return}
  if(matches.length>1){label.textContent="Mais de uma entrada local para essa placa. Selecione o veículo em Docas / saídas.";$("exitSummary").replaceChildren();return}
  if(matches.length===1){
    const vehicle=matches[0];state.exitContext=vehicle;$("exitId").value=vehicle.idLocal||"";
    label.textContent="Entrada localizada neste aparelho. Confira os dados abaixo.";
    $("exitSummary").innerHTML=vehicleFacts(vehicle)+'<div class="summary-item"><small>Motorista</small><strong>'+escapeHtml(vehicle.motorista)+'</strong></div>';
  }else{
    label.textContent="Entrada não encontrada neste aparelho. A saída será registrada sem vínculo, somente com autorização explícita.";
    $("exitSummary").innerHTML='<div class="banner">A entrada pode existir em outro aparelho. Confirme com a portaria antes de continuar.</div>';
    $("orphanExitConsent").classList.remove("hidden");
  }
}
function updateExitSaveButton(){
  const manual=$("exitManual").value==="true";
  if(manual)resolveManualExit();
  const plate=RomaneioOcrCore.compact($("manualPlate").value);
  const matches=manual?getPatio().filter(v=>v.portaria===$("portaria").value&&(RomaneioOcrCore.compact(v.placaBau||"")===plate||RomaneioOcrCore.compact(v.placaCavalo||"")===plate)):[];
  const valid=!manual||(RomaneioOcrCore.validPlate(plate)&&matches.length<2&&(matches.length===1||$("chkOrphanExit").checked));
  $("btnSaveExit").disabled=!(valid&&$("chkVistoriaSaida").checked);
}
$("chkVistoriaSaida").onchange=updateExitSaveButton;
$("manualPlate").oninput=()=>{$("chkOrphanExit").checked=false;updateExitSaveButton()};
$("chkOrphanExit").onchange=updateExitSaveButton;
$("btnCancelExit").onclick=()=>{stopMonitoring();showView("viewDocks");renderDocks()};$("btnSaveExit").onclick=async()=>{if(!$('chkVistoriaSaida').checked)return toast("Confirme a vistoria de saída.");await salvarSaida()};
async function salvarSaida(){try{setLoading("SALVANDO SAÍDA","Registrando hora e localização…");const manual=$("exitManual").value==="true",plate=(manual?(state.exitContext?.placaBau||$("manualPlate").value):state.exitContext?.placaBau||"").trim().toUpperCase(),h=human(),payload={idLocal:$("exitId").value||"",tipoRegistro:"Saida",isManual:manual?"true":"false",portaria:$("portaria").value,placaBau:plate,empresa:state.exitContext?.empresa||"",motorista:state.exitContext?.motorista||"",tipoVeiculo:state.exitContext?.tipoVeiculo||"",placaCavalo:state.exitContext?.placaCavalo||"",localizacao:currentGps(),vigia:CONFIG.vigia,vigiaEntrada:state.exitContext?.vigiaEntrada||state.exitContext?.vigia||"",porteVeiculo:state.exitContext?vehicleSize(state.exitContext):"",dataAtual:h.data,horaAtual:h.hora,calcoConfirmado:"SIM (SAÍDA)",vistoriaConfirmada:"SIM (SAÍDA)",modoRegistro:manual?(state.exitContext?"Manual / vinculada":"Manual / Órfã"):"Saída Expressa"};const delivery=await postPayload(payload,{silent:true});if(state.exitContext?.idLocal)removePatio(state.exitContext.idLocal);stopMonitoring();closeOverlay();showView("viewDocks");renderDocks();toast(delivery.queued?"Saída salva no aparelho; envio pendente.":"Saída enviada; confirme recebimento no servidor.")}catch{closeOverlay();stopMonitoring();showView("viewDocks");toast("Falha na saída; confira a fila local antes de continuar.")}}
function initializeServerControls(){
  $("serverUrl").value=localStorage.getItem("rd_server_url")||(!location.hostname.endsWith(".github.io")?location.origin:"");
  $("serverToken").value=syncToken();
  syncState(syncReady()?"Servidor configurado. Sincronização disponível.":"Configure endereço e chave do servidor. Registros ficam no aparelho.");
  $("btnSaveServer").onclick=async()=>{
    let url;try{url=new URL($("serverUrl").value.trim())}catch{return toast("Endereço do servidor inválido.")}
    if(url.protocol!=="https:"&&url.hostname!=="localhost"&&url.hostname!=="127.0.0.1")return toast("O servidor precisa usar HTTPS.");
    if(!$("serverToken").value.trim())return toast("Informe a chave de sincronização.");
    const token=$("serverToken").value.trim();
    if(navigator.onLine){
      try{await probeServer(url.origin,token)}
      catch(e){syncState("Não foi possível validar o banco do servidor.");return toast("Falha ao conectar. Confira endereço e chave.")}
    }
    localStorage.setItem("rd_server_url",url.origin);sessionStorage.setItem("rd_sync_token",token);
    syncState(navigator.onLine?"Banco do servidor validado. Sincronizando…":"Configuração guardada; envio pendente até voltar a conexão.");
    syncQueue();
  };
  $("btnSyncNow").onclick=()=>{if(!syncReady())return toast("Configure o servidor e a chave.");syncQueue()};
}
initializeServerControls();
$("portaria").onchange=updateMainKPIs;$("vigiaOperacao").value=CONFIG.vigia;
$("vigiaOperacao").onchange=()=>{if(state.active){$("vigiaOperacao").value=CONFIG.vigia;return toast("Encerre o atendimento antes de trocar o responsável.")}const name=$("vigiaOperacao").value.trim();if(name.length<2){$("vigiaOperacao").value=CONFIG.vigia;return toast("Informe o nome do responsável.")}CONFIG.vigia=name;localStorage.setItem("rd_vigia",name);toast("Responsável atualizado.")};
window.addEventListener("load",async()=>{try{await openDB()}catch{}updateMainKPIs();syncQueue();offerDraft()});


["motorista","placaBau","placaCavalo","rg","cnh"].forEach(id=>$(id).addEventListener("input",()=>{state.ocrManuallyEdited=true;updateEntryButton()}));
["empresa","tipoVeiculo","placaBau","placaCavalo","motorista","rg","cnh","materiais","ajudantes","observacoes"].forEach(id=>{const invalidate=()=>{if(state.fotoCarimbadaBase64){state.fotoCarimbadaBase64="";$("previewCarimbo").style.display="none";$("btnSaveEntry").disabled=true;toast("Dados alterados: refaça a selfie de confirmação.")}};$(id).addEventListener("input",invalidate);$(id).addEventListener("change",invalidate)});

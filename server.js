"use strict";
const http=require("node:http"),path=require("node:path"),fs=require("node:fs");
const {timingSafeEqual}=require("node:crypto");
const {DatabaseSync}=require("node:sqlite");
const ROOT=__dirname,PORT=Number(process.env.PORT||8080);
const DATABASE_FILE=process.env.ROMANEIO_DB_PATH||path.join(ROOT,"data","romaneio.sqlite");
const TOKEN=process.env.ROMANEIO_SYNC_TOKEN||"";
const allowedOrigins=new Set((process.env.ROMANEIO_ALLOWED_ORIGINS||"https://danielnep.github.io").split(",").map(s=>s.trim()).filter(Boolean));
const limitBytes=12*1024*1024;
let db;
function database(){
  if(db)return db;
  fs.mkdirSync(path.dirname(DATABASE_FILE),{recursive:true});
  db=new DatabaseSync(DATABASE_FILE);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
  db.exec("CREATE TABLE IF NOT EXISTS operations (operation_id TEXT PRIMARY KEY,tipo_registro TEXT NOT NULL,id_local TEXT,portaria TEXT,payload_json TEXT NOT NULL,saved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))); CREATE INDEX IF NOT EXISTS idx_operations_saved_at ON operations(saved_at);");
  return db;
}
function json(res,status,data,origin=""){
  if(origin&&allowedOrigins.has(origin)){res.setHeader("Access-Control-Allow-Origin",origin);res.setHeader("Vary","Origin")}
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
  res.end(JSON.stringify(data));
}
function authorized(req){
  if(!TOKEN||TOKEN.length<24)return false;
  const raw=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  const a=Buffer.from(raw),b=Buffer.from(TOKEN);
  return a.length===b.length&&timingSafeEqual(a,b);
}
async function requestBody(req){
  let total=0;const chunks=[];
  for await(const chunk of req){
    total+=chunk.length;if(total>limitBytes){const e=new Error("Payload acima de 12 MB");e.status=413;throw e}
    chunks.push(chunk);
  }
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8"))}
  catch{const e=new Error("JSON inválido");e.status=400;throw e}
}
const validId=id=>typeof id==="string"&&/^[A-Za-z0-9_-]{16,100}$/.test(id);
async function api(req,res,pathname,origin){
  if(!authorized(req)){json(res,401,{ok:false,error:"Credencial de sincronização inválida"},origin);return}
  if(req.method==="GET"&&pathname==="/api/status"){database();json(res,200,{ok:true,storage:"sqlite",status:"ready"},origin);return}
  if(req.method==="POST"&&pathname==="/api/records"){
    const data=await requestBody(req);
    if(!data||!validId(data.operationId)||!data.payload||typeof data.payload!=="object"||Array.isArray(data.payload)||typeof data.payload.tipoRegistro!=="string"||data.payload.tipoRegistro.length>120){
      json(res,400,{ok:false,error:"Registro inválido"},origin);return
    }
    const serialized=JSON.stringify(data.payload),conn=database();
    const existing=conn.prepare("SELECT operation_id,saved_at FROM operations WHERE operation_id=?").get(data.operationId);
    if(existing){json(res,200,{ok:true,confirmed:true,operationId:existing.operation_id,persistedAt:existing.saved_at,duplicate:true},origin);return}
    conn.prepare("INSERT INTO operations(operation_id,tipo_registro,id_local,portaria,payload_json) VALUES(?,?,?,?,?)")
      .run(data.operationId,data.payload.tipoRegistro,String(data.payload.idLocal||"").slice(0,128),String(data.payload.portaria||"").slice(0,80),serialized);
    const saved=conn.prepare("SELECT operation_id,saved_at FROM operations WHERE operation_id=?").get(data.operationId);
    json(res,201,{ok:true,confirmed:true,operationId:saved.operation_id,persistedAt:saved.saved_at},origin);return;
  }
  if(req.method==="GET"&&pathname.startsWith("/api/records/")){
    const id=decodeURIComponent(pathname.slice("/api/records/".length));
    if(!validId(id)){json(res,400,{ok:false,error:"Identificador inválido"},origin);return}
    const row=database().prepare("SELECT operation_id,saved_at FROM operations WHERE operation_id=?").get(id);
    json(res,row?200:404,row?{ok:true,confirmed:true,operationId:row.operation_id,persistedAt:row.saved_at}:{ok:false,confirmed:false},origin);return;
  }
  json(res,404,{ok:false,error:"Endpoint não encontrado"},origin);
}
function staticFile(req,res,pathname){
  if(req.method!=="GET"&&req.method!=="HEAD"){res.writeHead(405);res.end();return}
  let file;try{file=decodeURIComponent(pathname==="/"?"/index.html":pathname)}catch{res.writeHead(400);res.end();return}
  if(file.includes("\0")||file.includes("\\")||file.split("/").includes("..")){res.writeHead(403);res.end();return}
  const full=path.resolve(ROOT,"."+file);
  const rel=path.relative(ROOT,full).replaceAll("\\","/");
  if(!full.startsWith(ROOT+path.sep)||!(/^(index\.html|css\/[^/]+\.css|js\/[^/]+\.js|assets\/[^/]+\.(png|jpg|jpeg|svg|webp)|[0-9]+\.png)$/i).test(rel)){res.writeHead(404);res.end();return}
  fs.stat(full,(err,stat)=>{
    if(err||!stat.isFile()){res.writeHead(404);res.end();return}
    const types={".html":"text/html",".css":"text/css",".js":"application/javascript",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".svg":"image/svg+xml",".webp":"image/webp"};
    res.writeHead(200,{"Content-Type":(types[path.extname(full)]||"application/octet-stream")+"; charset=utf-8","X-Content-Type-Options":"nosniff"});
    if(req.method==="HEAD")res.end();else fs.createReadStream(full).pipe(res);
  });
}
function handler(req,res){
  const origin=req.headers.origin||"";
  let pathname;try{pathname=new URL(req.url||"/","http://127.0.0.1").pathname}catch{res.writeHead(400);res.end();return}
  if(req.method==="OPTIONS"&&pathname.startsWith("/api/")){
    if(origin&&allowedOrigins.has(origin)){res.writeHead(204,{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Authorization,Content-Type","Vary":"Origin"});res.end()}
    else{res.writeHead(403);res.end()}return;
  }
  if(origin&&!allowedOrigins.has(origin)&&!origin.startsWith("http://localhost:")&&!origin.startsWith("http://127.0.0.1:")){json(res,403,{ok:false,error:"Origem não permitida"});return}
  if(pathname==="/health"){json(res,200,{ok:true});return}
  if(pathname.startsWith("/api/")){api(req,res,pathname,origin).catch(e=>json(res,e.status||500,{ok:false,error:e.status?e.message:"Erro interno de persistência"},origin));return}
  staticFile(req,res,pathname);
}
function start(){
  if(!TOKEN||TOKEN.length<24)throw Error("Defina ROMANEIO_SYNC_TOKEN com pelo menos 24 caracteres.");
  database();return http.createServer(handler).listen(PORT,"0.0.0.0",()=>console.log("Romaneio API na porta "+PORT));
}
if(require.main===module)start();
module.exports={start,handler,database};

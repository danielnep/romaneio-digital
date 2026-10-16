"use strict";
const { test }=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {once}=require("node:events"),{randomBytes}=require("node:crypto");
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"romaneio-server-"));
const token=randomBytes(32).toString("hex");
process.env.ROMANEIO_SYNC_TOKEN=token;
process.env.ROMANEIO_DB_PATH=path.join(tmp,"romaneio.sqlite");
process.env.PORT="0";
const app=require("../server");
test("servidor: grava SQLite, confirma ACK e não duplica tentativas",async()=>{
  const server=app.start();
  try{
    if(!server.listening)await once(server,"listening");
    const base="http://127.0.0.1:"+server.address().port;
    const id="test_"+randomBytes(16).toString("hex");
    const payload={tipoRegistro:"Entrada",idLocal:"abc",portaria:"P1",placaBau:"ABC1234",motorista:"Teste"};
    const headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"};
    const unauthorized=await fetch(base+"/api/status");
    assert.equal(unauthorized.status,401);
    const status=await fetch(base+"/api/status",{headers});
    assert.equal(status.status,200);assert.equal((await status.json()).storage,"sqlite");
    const record=async()=>fetch(base+"/api/records",{method:"POST",headers,body:JSON.stringify({operationId:id,payload})});
    const first=await record(),firstJson=await first.json();
    assert.equal(first.status,201);assert.equal(firstJson.ok,true);assert.equal(firstJson.confirmed,true);assert.equal(firstJson.operationId,id);
    const second=await record(),secondJson=await second.json();
    assert.equal(second.status,200);assert.equal(secondJson.duplicate,true);assert.equal(secondJson.persistedAt,firstJson.persistedAt);
    const verify=await fetch(base+"/api/records/"+id,{headers});
    assert.equal(verify.status,200);assert.equal((await verify.json()).confirmed,true);
    const count=app.database().prepare("SELECT COUNT(*) AS n FROM operations WHERE operation_id=?").get(id);
    assert.equal(count.n,1);
    const persist=app.database().prepare("SELECT payload_json FROM operations WHERE operation_id=?").get(id);
    assert.equal(JSON.parse(persist.payload_json).motorista,"Teste");
    const withoutToken=await fetch(base+"/api/records/"+id);
    assert.equal(withoutToken.status,401);
    const invalid=await fetch(base+"/api/records",{method:"POST",headers,body:"not json"});
    assert.equal(invalid.status,400);
  }finally{await new Promise(resolve=>server.close(resolve))}
});

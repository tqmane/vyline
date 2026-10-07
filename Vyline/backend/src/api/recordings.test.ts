import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

test("authenticated recording API: start/quota/chunks/Range/download/delete and no cross-account access", async () => {
  const root = await mkdtemp(join(tmpdir(), "vyline-recording-api-"));
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
    const { Hono } = await import('hono');
    const { cors } = await import('hono/cors');
    const { createRecordingRouter } = await import(${JSON.stringify(new URL("./recordings.ts", import.meta.url).href)});
    const service = await import(${JSON.stringify(new URL("../service/callRecordingService.ts", import.meta.url).href)});
    const { getBackupStorageUsage } = await import(${JSON.stringify(new URL("../service/backupService.ts", import.meta.url).href)});
    const { createRemoteAccessGuard } = await import(${JSON.stringify(new URL("../remoteAccess.ts", import.meta.url).href)});
    const { strict: assert } = await import('node:assert');
    const app = new Hono();
    app.use('*',cors());
    app.use('/line/:accountId/*', createRemoteAccessGuard({ remoteAuthRequired:true, mode:'subdevice', authenticateSubdevice:async(token,installation)=>token==='fixture'&&installation==='installation'?{accountId:'owner'}:null, authorizeSubdevice:(c,s)=>s.accountId===c.req.param('accountId')?null:'account mismatch' }));
    app.route('/line/:accountId/recordings', createRecordingRouter({ ...service, startCallRecording:(owner,input)=>service.startCallRecording(owner,input,()=>({accountId:'owner',sessionId:'session',to:'c'+'1'.repeat(32),state:'in-call',kind:'AUDIO',transport:'planet',startedAt:Date.now()})) }));
    const headers={Authorization:'Bearer fixture','X-Vyline-Installation-Id':'installation'};
    const req=(path,method='GET',body,extra={})=>app.request('http://local/line/owner/recordings'+path,{method,headers:{...headers,...extra},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
    assert.equal((await app.request('http://local/line/owner/recordings')).status,401);
    assert.equal((await app.request('http://local/line/other/recordings',{headers})).status,403);
    assert.equal((await app.request('http://local/line/other/recordings/paths',{headers})).status,403);
    const paths=await req('/paths'); assert.equal(paths.status,200); const pathItems=(await paths.json()).items; assert.ok(pathItems.includes(process.env.VYLINE_STORAGE_DIR));
    assert.equal((await req('/paths?prefix='+encodeURIComponent(process.env.VYLINE_DATA_DIR))).status,400);
    assert.equal((await req('/start','POST',{sessionId:'session',title:'generated',kind:'audio',mimeType:'audio/webm',consentAccepted:true})).status,400);
    const start=await req('/start','POST',{sessionId:'session',title:'generated',kind:'audio',mimeType:'audio/mp4;codecs=mp4a.40.2',consentAccepted:true});
    assert.equal(start.status,201); const row=(await start.json()).recording;
    const empty=await req('/'+row.id+'/file'); assert.equal(empty.status,200); assert.equal((await empty.arrayBuffer()).byteLength,0);
    assert.equal((await getBackupStorageUsage('owner')).recordingReservedBytes,2*1024**3);
    const chunk=await req('/'+row.id+'/chunks','PUT','abc',{'X-Recording-Offset':'0','Content-Type':'application/octet-stream'}); assert.equal(chunk.status,200);
    assert.equal((await req('/'+row.id+'/chunks','PUT','xyz',{'X-Recording-Offset':'0'})).status,409);
    assert.equal((await req('/'+row.id+'/finish','POST',{durationMs:1000})).status,200);
    assert.equal((await getBackupStorageUsage('owner')).recordingReservedBytes,0);
    const range=await req('/'+row.id+'/file','GET',undefined,{Range:'bytes=1-2'}); assert.equal(range.status,206); assert.equal(range.headers.get('content-range'),'bytes 1-2/3'); assert.equal(await range.text(),'bc');
    assert.equal((await req('/'+row.id+'/file','GET',undefined,{Range:'bytes=3-'})).status,416);
    const file=await req('/'+row.id+'/file?download=1'); assert.match(file.headers.get('content-disposition'),/^attachment/); assert.equal(file.headers.get('cache-control'),'private, no-store'); assert.equal(await file.text(),'abc');
    const cookie={Cookie:'vyline_subdevice_session=fixture; vyline_subdevice_installation=installation'};
    const nativeUrl='http://local/line/owner/recordings/'+row.id;
    const native=await app.request(nativeUrl+'/file',{headers:{...cookie,Range:'bytes=1-2'}}); assert.equal(native.status,206); assert.equal(await native.text(),'bc');
    const head=await app.request(nativeUrl+'/file?download=1',{method:'HEAD',headers:cookie}); assert.equal(head.status,200); assert.equal(head.headers.get('content-length'),'3'); assert.match(head.headers.get('content-disposition'),/^attachment/);
    // app.request consumes the Response in memory; exercise Bun's actual HTTP
    // serializer too, with the nonzero, open-ended range used by video players.
    const wireStart=await req('/start','POST',{sessionId:'session',title:'generated range fixture',kind:'video',mimeType:'video/mp4',consentAccepted:true});
    assert.equal(wireStart.status,201);
    const wireRow=(await wireStart.json()).recording;
    const original=Buffer.alloc(1282408);
    for(let i=0;i<original.length;i++) original[i]=(i*29+(i>>>8))%251;
    for(let offset=0;offset<original.length;offset+=262144)
      await service.appendCallRecording('owner',wireRow.id,offset,original.subarray(offset,offset+262144));
    await req('/'+wireRow.id+'/finish','POST',{durationMs:28282});
    const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:app.fetch});
    try {
      const wireUrl=new URL('/line/owner/recordings/'+wireRow.id+'/file',server.url);
      for (const [header,start,end] of [[undefined,0,original.length-1],['bytes=0-15',0,15],['bytes=720896-',720896,original.length-1],['bytes=327680-393215',327680,393215],['bytes=-127',original.length-127,original.length-1]]) {
        const response=await fetch(wireUrl,{headers:{...cookie,...(header?{Range:header}:{})},signal:AbortSignal.timeout(5000)});
        assert.equal(response.status,header?206:200);
        const length=response.headers.get('content-length');
        if(length!==null) assert.equal(length,String(end-start+1));
        else assert.equal(response.headers.get('transfer-encoding'),'chunked');
        assert.equal(response.headers.get('content-range'),header?'bytes '+start+'-'+end+'/'+original.length:null);
        assert.ok(Buffer.from(await response.arrayBuffer()).equals(original.subarray(start,end+1)),'HTTP body must equal the exact requested bytes');
      }
      const head=await fetch(wireUrl,{method:'HEAD',headers:{...cookie,Range:'bytes=720896-'},signal:AbortSignal.timeout(5000)});
      assert.equal(head.status,206); assert.equal(head.headers.get('content-length'),'561512'); assert.equal((await head.arrayBuffer()).byteLength,0);
      assert.equal((await fetch(wireUrl,{headers:{...cookie,Range:'bytes='+original.length+'-'},signal:AbortSignal.timeout(5000)})).status,416);
    } finally { server.stop(true); }
    await req('/'+wireRow.id,'DELETE');
    assert.equal((await app.request(nativeUrl,{method:'DELETE',headers:cookie})).status,401);
    assert.equal((await app.request(nativeUrl+'/file',{headers:{Cookie:'vyline_subdevice_session=fixture; vyline_subdevice_installation=wrong'}})).status,401);
    const list=await req(''); assert.equal((await list.json()).items.length,1);
    assert.equal((await req('/'+row.id,'DELETE')).status,200);
    assert.equal((await req('/'+row.id+'/file')).status,404);
    console.log('PASS');
  `,
    ],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: {
        ...process.env,
        LOG_LEVEL: "silent",
        VYLINE_DATA_DIR: join(root, "data"),
        VYLINE_STORAGE_DIR: join(root, "storage"),
        VYLINE_BACKUP_DIR: join(root, "backups"),
        VYLINE_MEDIA_INDEX_PATH: join(root, "media.sqlite"),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  try {
    const [code, out, err] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (code) throw new Error(out + err);
    expect(out).toContain("PASS");
  } finally {
    child.kill();
    await rm(root, { recursive: true, force: true });
  }
}, 15000);

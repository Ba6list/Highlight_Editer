import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
const APP='https://nobori-highlight-studio.nbrhg.workers.dev';
async function harness(handler) {
  const session={},local={},calls=[]; let listener;
  const storage = data => ({
    setAccessLevel: async value => { assert.equal(value.accessLevel, 'TRUSTED_CONTEXTS'); },
    get: async key => ({ [key]: structuredClone(data[key]) }),
    set: async values => { Object.assign(data, structuredClone(values)); },
    remove: async key => { delete data[key]; },
  });
  const chrome={ storage:{session:storage(session),local:storage(local)}, runtime:{id:'test-extension', getURL:path=>'chrome-extension://test-extension/'+path, onMessage:{addListener:fn=>{listener=fn;}}} };
  vm.runInNewContext(source, { chrome, crypto:webcrypto, AbortSignal, Date, Promise, Error, fetch:async(url,options)=>{calls.push({url,options});return handler(url,options);} });
  const popup={id:chrome.runtime.id,url:chrome.runtime.getURL('popup.html')};
  const twitch={id:chrome.runtime.id,url:'https://www.twitch.tv/nobori_official',frameId:0};
  const send=(message,sender=popup)=>new Promise(resolve=>listener(message,sender,resolve));
  session.connection={token:'test-scoped-token',name:'スタッフ',expires:Date.now()+60000};
  return {session,local,calls,popup,twitch,send};
}
test('配信ページには接続トークンを返さず、認証付きAPIは固定の保存用URLのみ',async()=>{
 const h=await harness(()=>Response.json({name:'スタッフ',expires:Date.now()+60000,clips:[]}));
 const reply=await h.send({action:'status'},h.twitch);
 assert.equal(reply.ok,true);assert.ok(!JSON.stringify(reply).includes('test-scoped-token'));
 assert.equal(h.calls[0].url,APP+'/api/extension/status');assert.equal(h.calls[0].options.credentials,'omit');
 assert.equal(h.calls[0].options.headers.Authorization,'Bearer test-scoped-token');
});
test('他チャンネル・サブフレーム・他拡張は保存不可、Twitchからコード引換や任意URL要求も不可',async()=>{
 const h=await harness(()=>{throw Error('Unexpected HTTP');});
 for(const sender of [{...h.twitch,url:'https://www.twitch.tv/other'},{...h.twitch,frameId:1},{...h.twitch,id:'other'}]) {
  if(sender.id==='other') {h.send({action:'capture'},sender);continue;}
  assert.equal((await h.send({action:'capture'},sender)).ok,false);
 }
 assert.equal((await h.send({action:'pair',code:'x'},h.twitch)).ok,false);
 assert.equal((await h.send({action:'fetch',url:'https://evil.example'},h.twitch)).ok,false);
 assert.equal(h.calls.length,0);
});
test('応答不明時の要求ID・タイトル・秒数を永続化し、再試行でも同じ要求を送信',async()=>{
 let count=0;
 const h=await harness(()=>{ if(count++===0)throw Error('通信中断');return Response.json({id:'clip'}); });
 assert.equal((await h.send({action:'capture',title:'元のタイトル',duration:30},h.twitch)).ok,false);
 const pending=structuredClone(h.local.pendingCapture);assert.ok(pending.requestKey);
 assert.equal((await h.send({action:'capture',title:'変えたタイトル',duration:60},h.twitch)).ok,true);
 assert.deepEqual(JSON.parse(h.calls[0].options.body),pending);assert.deepEqual(JSON.parse(h.calls[1].options.body),pending);
 assert.equal(h.local.pendingCapture,undefined);
});
test('同時保存操作を一つにまとめる',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const h=await harness(async()=>{await gate;return Response.json({id:'clip'});});
 const a=h.send({action:'capture'},h.twitch),b=h.send({action:'capture'},h.twitch);
 await new Promise(resolve=>setImmediate(resolve));release();
 assert.equal((await a).ok,true);assert.equal((await b).ok,true);assert.equal(h.calls.length,1);
});
test('401またはローカル期限切れで認証を破棄し、未確認の保存要求は保持',async()=>{
 const h=await harness(()=>Response.json({error:'期限切れ'},{status:401}));
 h.local.pendingCapture={requestKey:webcrypto.randomUUID(),title:'未確認',duration:30};
 assert.equal((await h.send({action:'status'},h.twitch)).ok,false);assert.equal(h.session.connection,undefined);
 assert.ok(h.local.pendingCapture);
 h.session.connection={token:'expired',expires:0};
 assert.equal((await h.send({action:'status'},h.twitch)).ok,false);assert.equal(h.calls.length,1);
});
test('接続コードをpopupで引換、Twitchへトークンを返さない',async()=>{
 const h=await harness(()=>Response.json({token:'new-token',name:'接続者',expires:Date.now()+60000}));
 const r=await h.send({action:'pair',code:webcrypto.randomUUID()+webcrypto.randomUUID()});
 assert.equal(r.ok,true);assert.equal(h.session.connection.token,'new-token');assert.equal(r.data.token,undefined);
 assert.equal(h.calls[0].options.headers.Authorization,undefined);
});
test('サーバー失効に失敗した場合は解除成功と表示しない',async()=>{
 const h=await harness(()=>{throw Error('network failed');});
 assert.equal((await h.send({action:'disconnect'})).ok,false);assert.ok(h.session.connection);
});
test('配布manifestの権限はstorage・公式Twitch注入・専用APIのみ',async()=>{
 const m=JSON.parse(await readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));
 assert.deepEqual(m.permissions,['storage']);assert.deepEqual(m.host_permissions,[APP+'/*']);
 assert.equal(m.manifest_version,3);assert.equal(m.externally_connectable,undefined);
 assert.deepEqual(m.content_scripts[0].matches,['https://www.twitch.tv/*']);
});

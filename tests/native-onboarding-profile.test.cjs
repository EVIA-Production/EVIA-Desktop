const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function host(responses,choice=0){
 const calls=[],writes=[],navigations=[],external=[];
 const deps={electron:{app:{getPath:()=>'/test'},shell:{openExternal:async url=>external.push(url)},dialog:{showMessageBox:async()=>({response:choice})}},path,fs:{mkdirSync(){},writeFileSync:(p)=>writes.push(p)},keytar:{getPassword:async()=> 'fixture-desktop-token'},'./header-controller':{},'./overlay-windows':{},'./desktop-bridge':{desktopBridge:{navigateTo:async url=>{navigations.push(url);return false;}}},'./web-app-url':{webAppUrl:s=>s},'./setup-error-message':require('../dist/main/setup-error-message.js')};
 const module={exports:{}};
 const fetch=async(url,init)=>{calls.push({url,init});const response=responses.shift();if(!response)throw Error('Unexpected request');return {ok:response.status<400,status:response.status,json:async()=>response.body};};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/main/native-onboarding.js'),'utf8'),{require:id=>deps[id],module,exports:module.exports,Buffer,Blob,FormData,Uint8Array,AbortSignal,fetch,URL,console:{error(){}},process:{platform:'darwin',env:{}}});
 return {save:module.exports.saveContext,checkout:module.exports.openWebCheckout,calls,writes,navigations,external,deps};
}
test('typed profile is saved and activated through existing API when draft endpoint is undeployed',async()=>{
 const h=host([{status:404},{status:200,body:[]},{status:200,body:{id:17}},{status:200,body:{}}]);
 await h.save({fields:{offer:'Scheduling software',proof:'A public case study'},customGoal:'Book a demo'},'test');
 const body=JSON.parse(h.calls[2].init.body);assert.match(body.content,/Scheduling software/);assert.match(body.content,/Book a demo/);assert.equal(body.is_active,false);assert.ok(h.calls[3].url.endsWith('/prompts/17/activate'));
});
test('setup preserves German and never starts paid metadata inference',async()=>{
 const h=host([{status:200,body:{compiled_content:'Mein Angebot'}},{status:200,body:[]},{status:200,body:{id:17}},{status:200,body:{}}]);
 await h.save({language:'de',fields:{offer:'Produkt'}},'test');
 assert.equal(h.calls[0].init.body.get('language'),'de');
 const body=JSON.parse(h.calls[2].init.body);
 assert.equal(body.language,'de');assert.equal(body.name,'Mein Sales-Profil');assert.equal(body.generate_metadata,false);
});
test('malformed save response cannot request an undefined preset or finish setup',async()=>{
 const h=host([{status:200,body:{compiled_content:'Offer'}},{status:200,body:[]},{status:200,body:{}}]);
 await assert.rejects(h.save({fields:{offer:'Product'}},'test'),/could not be saved/);
 assert.equal(h.calls.length,3);
});
test('failed live-context sync keeps setup retryable instead of reporting success',async()=>{
 const h=host([{status:200,body:{compiled_content:'Offer'}},{status:200,body:[]},{status:200,body:{id:17}},{status:200,body:{context:{cache_synced:false}}}]);
 await assert.rejects(h.save({fields:{offer:'Product'}},'test'),/profile is saved.*live connection is not ready/);
 assert.equal(h.calls.length,4);
});
test('retry updates the saved preset rather than creating a duplicate',async()=>{
 const h=host([{status:200,body:{compiled_content:'Updated offer'}},{status:200,body:[{id:17,name:'My Sales Profile'}]},{status:200,body:{id:17}},{status:200,body:{context:{cache_synced:true}}}]);
 await h.save({fields:{offer:'Product'}},'test');
 assert.equal(h.calls[2].init.method,'PUT');assert.ok(h.calls[2].url.endsWith('/prompts/17'));
});
test('checkout carries desktop identity through both browser bridge and fallback',async()=>{
 const h=host([]);await h.checkout();
 assert.equal(new URL(h.navigations[0]).searchParams.get('desktop_token'),'fixture-desktop-token');
 assert.equal(h.external[0],h.navigations[0]);
});
test('connected browser bridge receives authenticated checkout without a second tab',async()=>{
 const h=host([]);let navigated;
 h.deps['./desktop-bridge'].desktopBridge.navigateTo=async url=>{navigated=url;return true;};
 await h.checkout();
 assert.equal(new URL(navigated).pathname,'/checkout');
 assert.equal(new URL(navigated).searchParams.get('desktop_token'),'fixture-desktop-token');
 assert.equal(h.external.length,0);
});
test('a server failure does not silently fall back and discard source import',async()=>{
 const h=host([{status:500}]);await assert.rejects(h.save({fields:{offer:'A'}},'test'),/500/);assert.equal(h.calls.length,1);
});
test('declining incomplete import never saves a falsely complete profile',async()=>{
 const h=host([{status:404}]);await assert.rejects(h.save({fields:{offer:'A'},website:'example.com'},'test'),/not been imported/);assert.equal(h.calls.length,1);assert.equal(h.writes.length,0);
});
test('source deferral retains document bytes only after explicit choice',async()=>{
 const h=host([{status:404},{status:200,body:[]},{status:200,body:{id:2}},{status:200,body:{}}],1);
 await h.save({fields:{offer:'A'},documentData:[{name:'notes.txt',type:'text/plain',bytes:new Uint8Array([65])}]},'test');
 assert.equal(h.writes.length,2);assert.ok(h.writes.some(p=>p.endsWith('1-notes.txt')));
});

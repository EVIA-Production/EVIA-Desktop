const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function host(responses,choice=0){
 const calls=[],writes=[];
 const deps={electron:{app:{getPath:()=>'/test'},dialog:{showMessageBox:async()=>({response:choice})}},path,fs:{mkdirSync(){},writeFileSync:(p)=>writes.push(p)},keytar:{},'./header-controller':{},'./overlay-windows':{},'./web-app-url':{webAppUrl:s=>s}};
 const module={exports:{}};
 const fetch=async(url,init)=>{calls.push({url,init});const response=responses.shift();if(!response)throw Error('Unexpected request');return {ok:response.status<400,status:response.status,json:async()=>response.body};};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/main/native-onboarding.js'),'utf8'),{require:id=>deps[id],module,exports:module.exports,Buffer,Blob,FormData,Uint8Array,AbortSignal,fetch,process:{platform:'darwin',env:{}}});
 return {save:module.exports.saveContext,calls,writes};
}
test('typed profile is saved and activated through existing API when draft endpoint is undeployed',async()=>{
 const h=host([{status:404},{status:200,body:[]},{status:200,body:{id:17}},{status:200,body:{}}]);
 await h.save({fields:{offer:'Scheduling software',proof:'A public case study'},customGoal:'Book a demo'},'test');
 const body=JSON.parse(h.calls[2].init.body);assert.match(body.content,/Scheduling software/);assert.match(body.content,/Book a demo/);assert.equal(body.is_active,false);assert.ok(h.calls[3].url.endsWith('/prompts/17/activate'));
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

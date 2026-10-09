const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function bridge() {
  const messages = [], logs = [];
  const module = {exports:{}};
  const deps = {http:{},ws:{WebSocket:{OPEN:1}},electron:{},child_process:{},'./capture-session-controller':{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/main/desktop-bridge.js'),'utf8'), {
    require:id=>deps[id],module,exports:module.exports,process:{env:{}},URL,setTimeout:()=>0,
    console:{log:text=>logs.push(text)},
  });
  const instance = module.exports.desktopBridge;
  const add = (origin,pathname) => {
    const client = {readyState:1,send:message=>messages.push({origin,pathname,message:JSON.parse(message)})};
    instance.activeClients.add(client);instance.clientOrigins.set(client,origin);
    if(pathname)instance.clientPaths.set(client,pathname);
  };
  return {instance,add,messages,logs};
}

test('checkout token is sent only to a tab on the checkout origin and never logged',async()=>{
  const h=bridge();h.add('http://127.0.0.1:9999');h.add('https://app.taylos.ai');
  assert.equal(await h.instance.navigateTo('https://app.taylos.ai/checkout?desktop_token=fixture-secret'),true);
  assert.equal(h.messages.length,1);assert.equal(h.messages[0].origin,'https://app.taylos.ai');
  assert.equal(h.logs.some(log=>log.includes('fixture-secret')),false);
});

test('checkout replaces the onboarding handoff tab before an older dashboard tab',async()=>{
  const h=bridge();h.add('https://app.taylos.ai','/activity');h.add('https://app.taylos.ai','/desktop/open');
  assert.equal(await h.instance.navigateTo('https://app.taylos.ai/checkout?desktop_token=fixture-secret'),true);
  assert.equal(h.messages.length,1);
  assert.equal(h.messages[0].pathname,'/desktop/open');
});

test('an unrelated local tab cannot consume an authenticated checkout handoff',async()=>{
  const h=bridge();h.add('http://127.0.0.1:9999');
  assert.equal(await h.instance.navigateTo('https://app.taylos.ai/checkout?desktop_token=fixture-secret'),false);
  assert.equal(h.messages.length,0);
});

function httpBridge() {
  let handleRequest;
  const module = {exports:{}};
  const server = {on(){}, listen(_port,_host,ready){ready();}};
  class WebSocketServer { on(){} }
  const deps = {
    http:{createServer(handler){handleRequest=handler;return server;}},
    ws:{Server:WebSocketServer,WebSocket:{OPEN:1}},
    electron:{app:{getVersion:()=> 'test'}},
    child_process:{},
    './capture-session-controller':{captureSessionController:{getSnapshot:()=>({state:'idle'})}},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/main/desktop-bridge.js'),'utf8'), {
    require:id=>deps[id],module,exports:module.exports,process:{env:{}},URL,
    setInterval:()=>0,console:{log(){},warn(){},error(){}},
  });
  const instance=module.exports.desktopBridge;
  instance.start();
  const request=(headers={},method='POST')=>new Promise(resolve=>{
    const response={status:200,headers:{},setHeader(key,value){this.headers[key]=value;},writeHead(status){this.status=status;},end(){resolve({status:this.status,headers:this.headers});}};
    handleRequest({url:'/logout',method,headers},response);
  });
  return {instance,request};
}

test('web logout requires an allowed browser origin and bearer token',async()=>{
  const h=httpBridge();let called=0;
  h.instance.setLogoutHandler(async()=>{called++;return 204;});
  assert.equal((await h.request({origin:'https://attacker.invalid',authorization:'Bearer fixture'})).status,403);
  assert.equal((await h.request({authorization:'Bearer fixture'})).status,403);
  assert.equal((await h.request({origin:'https://app.taylos.ai'})).status,403);
  assert.equal((await h.request({origin:'https://app.taylos.ai',authorization:'Bearer '+ 'x'.repeat(8193)})).status,403);
  assert.equal(called,0);
});

test('web logout hands only the bearer token to the authenticated session handler',async()=>{
  const h=httpBridge();let received;
  h.instance.setLogoutHandler(async token=>{received=token;return 204;});
  const response=await h.request({origin:'https://app.taylos.ai',authorization:'Bearer fixture-secret'});
  assert.equal(response.status,204);
  assert.equal(received,'fixture-secret');
  assert.equal(response.headers['Access-Control-Allow-Origin'],'https://app.taylos.ai');
});

test('web logout preserves a different desktop account and reports handler failures',async()=>{
  const h=httpBridge();const headers={origin:'https://app.taylos.ai',authorization:'Bearer fixture'};
  assert.equal((await h.request(headers)).status,503);
  h.instance.setLogoutHandler(async()=>409);
  assert.equal((await h.request(headers)).status,409);
  h.instance.setLogoutHandler(async()=>{throw new Error('offline');});
  assert.equal((await h.request(headers)).status,503);
});

test('logout preflight permits authorization without performing logout',async()=>{
  const h=httpBridge();let called=0;
  h.instance.setLogoutHandler(async()=>{called++;return 204;});
  const response=await h.request({origin:'https://app.taylos.ai','access-control-request-private-network':'true'},'OPTIONS');
  assert.equal(response.status,204);
  assert.equal(response.headers['Access-Control-Allow-Headers'],'Content-Type, Authorization');
  assert.equal(response.headers['Access-Control-Allow-Private-Network'],'true');
  assert.equal(called,0);
});

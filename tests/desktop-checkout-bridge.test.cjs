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

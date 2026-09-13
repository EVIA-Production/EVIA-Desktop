// Synchronize the reviewed flow into the desktop repository's distributable runtime.
const fs=require('node:fs');
const path=require('node:path');
const desktop=path.resolve(__dirname,'..');
const workspace=path.dirname(desktop);
const source=path.join(workspace,'output/onboarding-prototype');
const destination=path.join(desktop,'onboarding-runtime');
// Start from an empty runtime so removed or re-hashed build assets cannot linger.
fs.rmSync(path.join(destination,'output'),{recursive:true,force:true});
fs.rmSync(path.join(destination,'EVIA-Desktop'),{recursive:true,force:true});
const files=['local-onboarding.cjs','local-preload.cjs','native-windows.cjs','native-controls.node','native-controls.mm','native-product-layout.h','native-product-layout.test.mm','display-fit.cjs','permission-return.cjs','onboarding-i18n.js','goal-first-atlas-practice.html','goal-first-atlas-practice.js','goal-first-atlas-practice.css','atlas-shell.css','final-polish.css','atlas-review.css','glass-lens.js','assets','native-build'];
for(const file of files){
 const target=path.join(destination,'output/onboarding-prototype',file);
 fs.mkdirSync(path.dirname(target),{recursive:true});
 fs.cpSync(path.join(source,file),target,{recursive:true});
}
for(const relative of ['output/TAYLOS_SF_SYMBOLS_PACKAGE/03_VECTOR_SVG/medium','EVIA-Desktop/src/main/assets/icon-mac.png','EVIA-Desktop/src/renderer/overlay/assets/taylos_mark.png']){
 const target=path.join(destination,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.cpSync(path.join(workspace,relative),target,{recursive:true});
}
console.log('Staged native onboarding runtime. No account data copied.');

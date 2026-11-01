'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
let count=0;
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.git','release','artifacts'].includes(entry.name))continue;const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(entry.name.endsWith('.js')){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr);count++;}}}
walk(root);
const pages=fs.readdirSync(path.join(root,'src','pages')).filter(f=>f.endsWith('.html')&&f!=='index.html');
for(const page of pages){const base=page.slice(0,-5);for(const ext of ['js','html'])if(!fs.existsSync(path.join(root,'src','pages',base+'.'+ext)))throw new Error(`Missing ${base}.${ext}`);if(!fs.existsSync(path.join(root,'src','styles',base+'.css')))throw new Error(`Missing stylesheet ${base}`);}
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(Object.keys(pkg.dependencies||{}).length)throw new Error('Unexpected runtime frontend dependency.');
for(const name of ['react','next','vue','typescript','tailwindcss','@angular/core'])if(pkg.devDependencies?.[name])throw new Error(`Forbidden framework: ${name}`);
console.log(`Checked ${count} JavaScript files and ${pages.length} separate HTML pages. Technology rules passed.`);

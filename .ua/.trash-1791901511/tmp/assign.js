const n=require('./arch-nodes.json');const a=Array.isArray(n)?n:n.nodes;
const L={};const D={
'frontend-app':['Frontend App Routes','Next.js 15 app-router pages, layouts and route handlers of the NovelHub web UI.'],
'frontend-components':['Frontend Components','React components for reader, story, workspace, fandom, messaging, admin and shared UI widgets.'],
'frontend-lib':['Frontend Lib and State','Client-side API wrappers, session/CSRF helpers, navigation stack and React contexts.'],
'frontend-config':['Frontend Build and Assets','Frontend package, Next.js, Tailwind and TypeScript configuration, Dockerfile and public assets.'],
'catalog':['Catalog Service','Express/TypeScript catalog API: stories, chapters, search, middleware, workers, Prisma schema and its scripts.'],
'identity':['Identity Service','Go service handling login, sessions, roles and signed user headers with its own identity_db.'],
'library':['Library Service','Go service for bookmarks, reading history and user libraries.'],
'community':['Community Service','Go service for comments, Fandom forum and community features.'],
'messaging':['Messaging Service','Go service for direct messages, notifications and realtime delivery.'],
'workspace':['Workspace Service','Go service for translation-group workspaces and collaborative editing of chapters.'],
'media':['Media Service','TypeScript service for image and media upload, processing and serving.'],
'recommender':['Recommender Service','Python service producing story recommendations.'],
'database':['Database and Migrations','Postgres schema, idempotent SQL migrations and database container setup.'],
'events':['Event Contracts','Message-bus (RabbitMQ) event contract definitions shared between services.'],
'scripts':['Scripts and Tooling','Shell and Python helper scripts for branches, migrations, smoke tests and navigation checks.'],
'infra':['Infrastructure and Config','Root Docker Compose, nginx gateway, launcher, CI remnants and project-level configuration.'],
'docs':['Documentation and Plans','README, project guides and Plan/ documents describing design and work checklists.']};
function lay(x){const p=x.filePath,s=p.split('/');
if(p.startsWith('frontend/src/app'))return 'frontend-app';
if(p.startsWith('frontend/src/components'))return 'frontend-components';
if(p.startsWith('frontend/src/'))return 'frontend-lib';
if(s[0]=='frontend')return 'frontend-config';
if(s[0]=='catalog')return 'catalog';
if(s[0]=='services')return s[1];
if(s[0]=='sql'||s[0]=='postgres')return 'database';
if(s[0]=='events')return 'events';
if(s[0]=='scripts')return x.type=='document'?'docs':'scripts';
if(s[0]=='Plan')return 'docs';
if(s.length==1&&x.type=='document')return 'docs';
return 'infra';}
for(const x of a){const k=lay(x);(L[k]=L[k]||[]).push(x.id)}
const out=Object.keys(L).map(k=>({id:'layer:'+k,name:D[k][0],description:D[k][1],nodeIds:L[k]}));
require('fs').writeFileSync('../intermediate/layers.json',JSON.stringify(out,null,1));
console.log(a.length,out.reduce((s,l)=>s+l.nodeIds.length,0),out.map(l=>l.id+':'+l.nodeIds.length).join(' '));

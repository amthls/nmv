const r=require('./ua-file-extract-results-41.json');
const L={};for(const f of r.results)L[f.path]=f;
const P='services/workspace/';
const nodes=[],edges=[];
const files={
'blocks.go':['Content-block canonicalization, hashing, storage and hash diffing for chapter bodies.',['go','content-blocks','hashing','diff'],'moderate'],
'chapters.go':['Chapter revision lifecycle HTTP handlers: create, edit, delete, list/compare revisions and rewind, backed by ws_chapter_versions.',['go','api-handler','revisions','chapters'],'complex'],
'collab.go':['Draft collaboration handlers: locking, sharing, copying, offers, ownership transfer, orphan reclaim and shared-with-me listing.',['go','api-handler','collaboration','drafts'],'complex'],
'db.go':['Workspace database migration and block-rehash helpers run at startup.',['go','database','migration'],'simple'],
'drafts.go':['Draft CRUD, save, publish transaction, and pull-from-upstream preview/apply handlers.',['go','api-handler','drafts','publishing'],'complex'],
'events.go':['Transactional-outbox event enqueue and publisher loop that republishes workspace events to the message broker, plus stats endpoint.',['go','events','outbox','messaging'],'moderate'],
'http.go':['Service config loading, JSON helpers, internal HMAC auth, user header parsing and cached permission lookups.',['go','http','authentication','utility'],'moderate'],
'importer.go':['Imports chapters into the workspace as revisions.',['go','import','chapters'],'simple'],
'log.go':['Structured logging with secret redaction and request-logging middleware.',['go','logging','middleware'],'simple'],
'main.go':['Entry point of the workspace service: wires config, database, background loops and HTTP routes.',['go','entry-point','routing','server'],'moderate'],
'merge.go':['Three-way merge of block lists and metadata with conflict detection and resolution.',['go','merge','conflict-resolution','algorithm'],'moderate'],
'proposals.go':['Review-round workflow for drafts: submit, decide, withdraw, return, review and comment handlers.',['go','api-handler','review','proposals'],'complex'],
'quota.go':['Per-user write rate limiting with quota classes and a limiting middleware.',['go','rate-limiting','middleware'],'simple'],
'quota_test.go':['Unit tests for the write quota and quota classification.',['go','test','rate-limiting'],'simple'],
'schedule.go':['Scheduled publishing handlers and background loop that publishes due drafts and records failures.',['go','scheduling','publishing','background-job'],'moderate'],
'tasks.go':['Task board handlers for creating, claiming, starting, finishing and listing translation tasks with activity logging.',['go','api-handler','tasks','workflow'],'complex'],
'workspace_test.go':['Integration tests covering block hashing, merge, revisions, drafts, proposals, collaboration, tasks and scheduling using a test harness.',['go','test','integration-test','workspace'],'complex'],
};
const fnPick={
'blocks.go':['blockHash','storeBlocks','diffHashes'],
'chapters.go':['handleEdit','handleRewind','handleCompare'],
'collab.go':['handleDraftGet','handleOfferAccept','handleReclaim'],
'db.go':['migrate','rehashOnce'],
'drafts.go':['publishTx','handleDraftSave','handlePullApply'],
'events.go':['publishLoop','publishBatch'],
'http.go':['permission','loadConfig'],
'importer.go':['importChapters'],
'log.go':['withRequestLog'],
'main.go':['main','routes'],
'merge.go':['merge3x','resolve'],
'proposals.go':['handleReview','decide'],
'quota.go':['take','limitWrites'],
'schedule.go':['publishDue','scheduleLoop'],
'tasks.go':['handleTaskCreate','handleBoard'],
};
const sum={
 'handleEdit':'Handles chapter edit requests by appending a new revision under a head lock.',
 'handleRewind':'Rewinds a chapter to an earlier revision by copying that version as a new head.',
 'handleCompare':'Compares two chapter revisions and returns a block-level diff.',
 'handleDraftGet':'Returns a draft with its role-based access and lock state to the caller.',
 'handleOfferAccept':'Accepts a draft offer, transferring or copying the draft to the recipient.',
 'handleReclaim':'Lets an owner or admin reclaim orphaned drafts.',
 'publishTx':'Transactionally publishes a draft into the chapter revision history and enqueues events.',
 'handleDraftSave':'Saves draft content with optimistic version checking.',
 'handlePullApply':'Applies a three-way merge of upstream changes into a draft.',
 'blockHash':'Computes a stable hash of a block ignoring position and JSON key order.',
 'storeBlocks':'Persists a chapter body as content-addressed blocks.',
 'diffHashes':'Computes insert/delete/move operations between two block hash sequences.',
 'migrate':'Applies idempotent schema migration for workspace tables at startup.',
 'rehashOnce':'One-time rehash of stored blocks after the hash algorithm changed.',
 'publishLoop':'Background loop that polls the outbox and publishes pending events.',
 'publishBatch':'Publishes a batch of outbox events and marks them sent.',
 'permission':'Looks up a user permission with a short-lived cache.',
 'loadConfig':'Reads service configuration from environment variables.',
 'importChapters':'Bulk-imports chapters as workspace revisions.',
 'withRequestLog':'Middleware logging each request with status and duration.',
 'main':'Starts the workspace service, background loops and HTTP server.',
 'routes':'Registers all HTTP routes and middleware.',
 'merge3x':'Three-way block merge producing merged chunks and conflicts.',
 'resolve':'Applies user conflict resolutions to a merge result.',
 'handleReview':'Returns review data for a draft proposal round including diff and comments.',
 'decide':'Records a reviewer decision (approve, reject, return) on a proposal round.',
 'take':'Consumes quota tokens for a user and reports whether the write is allowed.',
 'limitWrites':'Middleware rejecting write requests that exceed the quota.',
 'publishDue':'Publishes scheduled drafts whose time has come.',
 'scheduleLoop':'Background ticker invoking publishDue.',
 'handleTaskCreate':'Creates a task, validating access and logging activity.',
 'handleBoard':'Builds the task board grouped by status for a story or group.',
};
const cx=(n)=>n>80?'complex':n>25?'moderate':'simple';
for(const [fn,[s,t,c]] of Object.entries(files)){
 const p=P+fn;nodes.push({id:'file:'+p,type:'file',name:fn,filePath:p,summary:s,tags:t,complexity:c,languageNotes:'Go package main of the workspace service.'});
 for(const n of fnPick[fn]||[]){const f=L[p].functions.find(x=>x.name===n);if(!f)throw n;
  nodes.push({id:`function:${p}:${n}`,type:'function',name:n,filePath:p,lineRange:[f.startLine,f.endLine],summary:sum[n],tags:['go',...t.slice(1,3)],complexity:cx(f.endLine-f.startLine)});
  edges.push({source:'file:'+p,target:`function:${p}:${n}`,type:'contains',direction:'forward',weight:1.0});}
}
const E=(a,b,t,w)=>edges.push({source:a,target:b,type:t,direction:'forward',weight:w});
for(const [a,b] of [['quota.go','quota_test.go'],['blocks.go','workspace_test.go'],['merge.go','workspace_test.go']])E('file:'+P+a,'file:'+P+b,'tested_by',0.5);
const F=(f,n)=>`function:${P}${f}:${n}`;
E(F('main.go','main'),F('http.go','loadConfig'),'calls',0.8);
E(F('main.go','main'),F('db.go','migrate'),'calls',0.8);
E(F('main.go','routes'),F('log.go','withRequestLog'),'calls',0.8);
E(F('main.go','routes'),F('quota.go','limitWrites'),'calls',0.8);
E(F('drafts.go','handlePullApply'),F('merge.go','merge3x'),'calls',0.8);
E(F('blocks.go','storeBlocks'),F('blocks.go','blockHash'),'calls',0.8);
nodes.push({id:'config:services/workspace/go.mod',type:'config',name:'go.mod',filePath:'services/workspace/go.mod',summary:'Go module definition for the workspace service (module nmv/workspace) and its dependencies.',tags:['configuration','go','dependencies'],complexity:'simple'});
nodes.push({id:'config:services/workspace/go.sum',type:'config',name:'go.sum',filePath:'services/workspace/go.sum',summary:'Checksum lock file for the workspace service Go dependencies.',tags:['configuration','go','lockfile'],complexity:'simple'});
E('config:services/workspace/go.mod','file:'+P+'main.go','configures',0.6);
E('config:services/workspace/go.sum','config:services/workspace/go.mod','related',0.5);
nodes.push({id:'schema:sql/database.sql',type:'schema',name:'database.sql',filePath:'sql/database.sql',summary:'Full Postgres schema for NovelHub: users, groups, stories, chapters, comments, notifications, posts, reports, recommendation tables, views and indexes.',tags:['database','schema-definition','postgres','migration'],complexity:'complex'});
for(const [t,l] of [['stories',292],['chapters',383],['users',64],['comments',601],['ws_chapter_versions',1398],['notifications',636],['albums',508]]){
 nodes.push({id:`table:sql/database.sql:${t}`,type:'table',name:t,filePath:'sql/database.sql',lineRange:[l,l],summary:t==='ws_chapter_versions'?'Revision history table for chapters used by the workspace service.':`Definition of the ${t} table in the main schema.`,tags:['database','table','postgres'],complexity:'simple'});
 E('schema:sql/database.sql',`table:sql/database.sql:${t}`,'contains',1.0);}
E('schema:sql/database.sql','file:'+P+'chapters.go','defines_schema',0.8);
nodes.push({id:'table:sql/seeds/albums.sql:albums',type:'table',name:'albums',filePath:'sql/seeds/albums.sql',summary:'Seed script that regenerates demo themed albums from existing stories; safe to re-run.',tags:['database','seed-data','sql','demo'],complexity:'moderate'});
E('table:sql/seeds/albums.sql:albums','table:sql/database.sql:albums','migrates',0.7);
const ids=new Set(nodes.map(n=>n.id));for(const e of edges)if(!ids.has(e.source)||!ids.has(e.target))console.log('bad',e.source,e.target);
console.log(nodes.length,edges.length);
require('fs').writeFileSync('C:/Users/Admin/Documents/vn/nmv/.ua/intermediate/batch-41.json',JSON.stringify({nodes,edges},null,1));

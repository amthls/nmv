const fs=require('fs');
const N=(id,type,fp,summary,tags,cx,ln)=>({id,type,name:fp.split('/').pop(),filePath:fp,summary,tags,complexity:cx,...(ln?{languageNotes:ln}:{})});
const E=(s,t,type,w)=>({source:s,target:t,type,direction:'forward',weight:w});
const out={};
out[28]={nodes:[
N('config:.env.example','config','.env.example','Template of environment variables (database, secrets, ports, service keys) copied to .env by the launcher.',['configuration','environment','secrets','template'],'moderate'),
N('document:CLAUDE.md','document','CLAUDE.md','Working instructions for the project: mandatory git/branch/PR workflow, back-navigation rules, planning conventions, common commands and known pitfalls.',['documentation','workflow','conventions','git'],'moderate'),
N('document:README.md','document','README.md','Source-of-truth project README describing NovelHub architecture, services, routes, tables, environment variables, startup and known limitations.',['documentation','entry-point','architecture','overview'],'complex'),
N('service:docker-compose.yml','service','docker-compose.yml','Docker Compose stack defining Postgres, PgBouncer, Redis, RabbitMQ, search, gateway, catalog, worker and the microservices (identity, media, messaging, community, library, recommender, workspace) plus frontend and tunnel.',['orchestration','infrastructure','containerization','deployment'],'complex'),
N('config:package.json','config','package.json','Root package manifest with helper scripts and dev dependencies for repository-level tooling.',['configuration','npm','build-system'],'simple')],
edges:[E('document:README.md','service:docker-compose.yml','documents',0.5),E('document:README.md','config:.env.example','documents',0.5),E('config:.env.example','service:docker-compose.yml','configures',0.6),E('document:CLAUDE.md','document:README.md','related',0.5),E('document:CLAUDE.md','document:Plan/navigation.md','documents',0.5)]};
const P=(n,s,tags,cx)=>N('document:Plan/'+n,'document','Plan/'+n,s,['plan','documentation',...tags],cx);
out[29]={nodes:[
P('ar.md','Short rough note listing initial stack choices (Next.js, Docker Compose, Postgres) and separating backend/frontend directories.',['notes'],'simple'),
P('branch-workflow.md','Checklist plan for automating the branch, PR and plan-file workflow with helper scripts.',['git','workflow'],'simple'),
P('catalog.md','Phase I plan for the catalog service, the remainder of the former monolithic backend.',['catalog','microservices'],'moderate'),
P('chapter-workspace.md','Detailed plan for the chapter workspace with an official branch and draft revisions in a pull-request style.',['workspace','chapters','design'],'complex'),
P('community.md','Phase F plan for the TypeScript community service.',['community','microservices'],'moderate'),
P('dm-labels-block-pin.md','Plan for direct-message labels, label search, blocking and pinning.',['messaging','feature'],'moderate'),
P('identity.md','Phase B plan for the Go identity service covering login, sessions, signed headers and data sync.',['identity','microservices','security'],'complex'),
P('library.md','Phase G plan for the Go library service handling follows, bookmarks, albums and reading history.',['library','microservices'],'moderate'),
P('load-and-layout.md','Plan for unified search, story cards, non-bloating grids and overload protection.',['frontend','performance'],'simple'),
P('load.md','Research and plan for reducing request load and adding per-user write rate limits.',['performance','rate-limiting'],'moderate'),
P('media.md','Phase D plan for the TypeScript media service.',['media','microservices'],'simple'),
P('messaging.md','Phase E plan for the Go messaging service, split into four branches.',['messaging','microservices'],'complex'),
P('microservices.md','Master plan for splitting NovelHub into multiple services, with service table, phases, shared rules and data consistency design.',['microservices','architecture','roadmap'],'complex'),
P('navigation.md','Plan for back navigation based on the previous in-site route, removing hard-coded breadcrumbs.',['frontend','navigation'],'moderate'),
P('next15-and-push.md','Plan to push code to GitHub and upgrade Next.js 14 to 15.',['nextjs','upgrade'],'simple'),
P('no-approval.md','Plan to remove the content approval step so admins and mods only take down violating content.',['moderation','feature'],'moderate'),
P('recommender.md','Phase H plan for the Python recommender service.',['recommender','microservices'],'moderate'),
P('remove-backup-purge.md','Plan to remove backups and the automatic purge of taken-down stories after 60 days.',['cleanup','feature'],'simple'),
P('remove-ratings.md','Plan to fully remove the story rating feature.',['cleanup','feature'],'simple'),
P('review-followups.md','Plan fixing items from code review follow-ups (#38, #43, #45).',['review','fixes'],'moderate')],edges:[]};
for(const k of ['catalog','community','identity','library','media','messaging','recommender']) out[29].edges.push(E('document:Plan/'+k+'.md','document:Plan/microservices.md','related',0.5));
out[29].edges.push(E('document:Plan/navigation.md','document:CLAUDE.md','related',0.5));
out[30]={nodes:[
P('scale-phase1.md','Plan for scaling to a few thousand concurrent users, plus CI/CD and security foundations, with technical gotchas.',['scaling','ci-cd'],'complex'),
P('security-hardening.md','Plan for security fixes from the 2026-10-09 audit report.',['security','hardening'],'moderate'),
P('smart-codes.md','Plan for smart identifier codes for entities.',['identifiers','feature'],'moderate'),
P('ui-overhaul.md','Plan for batch UI fixes requested on 2026-10-12, delivered as separate PRs.',['frontend','ui'],'moderate')],
edges:[E('document:Plan/security-hardening.md','document:Plan/scale-phase1.md','related',0.5)]};
out[31]={nodes:[
N('config:catalog/.env.example','config','catalog/.env.example','Example environment for running the catalog service locally (port, node env, database URL, CORS origin).',['configuration','environment','catalog'],'simple'),
N('file:catalog/docker-entrypoint.sh','file','catalog/docker-entrypoint.sh','Container entrypoint that starts as root, grants the node user write access to uploads/exports/cache directories, then execs the command as node.',['entry-point','shell','docker','permissions'],'simple','POSIX sh using setpriv to drop privileges.'),
N('config:catalog/package.json','config','catalog/package.json','Package manifest for the catalog Express service with scripts, dependencies and dev dependencies.',['configuration','npm','catalog','build-system'],'moderate'),
N('config:catalog/tsconfig.json','config','catalog/tsconfig.json','TypeScript compiler configuration for the catalog service build.',['configuration','typescript','build-system'],'simple')],
edges:[E('config:catalog/.env.example','config:catalog/package.json','configures',0.6),E('config:catalog/tsconfig.json','config:catalog/package.json','configures',0.6)]};
const evs=[['catalog.chapter.read.v1.json','JSON schema for the catalog.chapter.read event published when a chapter is read.'],['catalog.story.viewed.v1.json','JSON schema for the catalog.story.viewed event published when a story is viewed.'],['envelope.v1.json','Base JSON schema envelope for every event on the novelhub.events exchange, with versioning and dedupe rules.'],['identity.alert.v1.json','JSON schema for identity alert events.'],['identity.user.v1.json','JSON schema for identity user created/updated/deleted events used to sync user copies.'],['library.album.story_added.v1.json','JSON schema for the event emitted when a story is added to an album.'],['library.album.story_removed.v1.json','JSON schema for the event emitted when a story is removed from an album.'],['library.bookmark.created.v1.json','JSON schema for the event emitted when a bookmark is created.'],['library.bookmark.deleted.v1.json','JSON schema for the event emitted when a bookmark is deleted.'],['library.story.followed.v1.json','JSON schema for the event emitted when a user follows a story.'],['library.story.unfollowed.v1.json','JSON schema for the event emitted when a user unfollows a story.'],['workspace.revision.merged.v1.json','JSON schema for the event emitted when a workspace revision is merged.'],['workspace.task.opened.v1.json','JSON schema for the event emitted when a workspace task is opened.']];
out[32]={nodes:evs.map(([f,s])=>N('config:events/'+f,'config','events/'+f,s,['event-schema','json-schema','messaging','contract'],'simple')),edges:evs.filter(x=>!x[0].startsWith('envelope')).map(([f])=>E('config:events/'+f,'config:events/envelope.v1.json','depends_on',0.6))};
for(const k in out){
 fs.writeFileSync('intermediate/batch-'+k+'.json',JSON.stringify(out[k],null,1));
 console.log(k,out[k].nodes.length,out[k].edges.length);
}

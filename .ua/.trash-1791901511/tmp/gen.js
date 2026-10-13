const fs=require('fs');
const T={
'frontend/.env.example':['config','Template of public Next.js environment variables (API URL, site name, site URL) for the frontend.',['configuration','environment','frontend'],'simple'],
'frontend/.env.local':['config','Local development values for the frontend public environment variables pointing at the catalog API and localhost site.',['configuration','environment','frontend'],'simple'],
'frontend/package.json':['config','npm manifest for the Next.js frontend with scripts and dependencies.',['configuration','npm','nextjs','build-system'],'simple'],
'frontend/tsconfig.json':['config','TypeScript compiler configuration for the Next.js frontend including path aliases.',['configuration','typescript','build-system'],'simple'],
'scripts/README.md':['document','Guide to the Python helper scripts: requirements, starting the project, smoke tests and the crawler.',['documentation','scripts','tooling'],'moderate'],
'scripts/check-nav.sh':['file','Shell check that enforces the frontend navigation rules (no router.back, no direct next/link imports).',['script','lint','navigation','ci'],'simple'],
'scripts/migrate.sh':['file','Applies idempotent SQL migrations from sql/migrations to the Postgres databases via psql in Docker.',['script','migration','database','deployment'],'moderate'],
'scripts/new-branch.sh':['file','Creates a fresh work branch from origin/main and scaffolds the Branches/ info file, carrying over uncommitted changes.',['script','git','workflow','tooling'],'simple'],
'services/identity/commonpasswords.txt':['document','Word list of common passwords used by the identity service to reject weak passwords.',['data','security','password-policy'],'complex'],
'services/identity/go.mod':['config','Go module definition for the identity service and its dependencies (jwt, pgx, amqp).',['configuration','go','dependencies'],'simple'],
'services/identity/go.sum':['config','Go dependency checksum lockfile for the identity service.',['configuration','go','lockfile'],'simple'],
'services/media/docker-entrypoint.sh':['file','Container entrypoint that makes writable directories usable then drops privileges to the node user for the media service.',['script','entrypoint','docker','media'],'simple'],
'services/media/package.json':['config','npm manifest for the media service with build/test scripts and dependencies.',['configuration','npm','media'],'simple'],
'services/media/tsconfig.json':['config','TypeScript compiler configuration for the media service.',['configuration','typescript','media'],'simple'],
'.gitattributes':['config','Git attributes forcing LF endings for shell scripts and other files.',['configuration','git','line-endings'],'simple'],
'.github/dependabot.yml':['config','Dependabot configuration listing the package ecosystems and update schedules monitored.',['configuration','dependencies','automation'],'moderate'],
'.ua/config.json':['config','Understand-Anything tool configuration setting output language to English.',['configuration','tooling'],'simple'],
'Plan/Trang chủ.docx':['document','Word planning document for the home page design.',['documentation','planning','homepage'],'simple'],
'catalog/prisma/schema.prisma':['schema','Prisma schema describing the catalog domain models and enums (users, stories, approvals, groups).',['schema-definition','database','prisma','data-model'],'complex'],
'catalog/scripts/check-db.ts':['file','Script that checks database connectivity and prints a summary of table contents.',['script','database','diagnostics'],'moderate'],
'catalog/scripts/import-from-docmep.ts':['file','One-off importer that copies legacy Docmep data and files into the catalog database with slug generation.',['script','import','migration','data'],'complex'],
'catalog/scripts/import-sql.ts':['file','Script that executes a SQL file against the database to import data.',['script','import','database'],'simple'],
'catalog/scripts/test-run.js':['file','Throwaway script referencing legacy backend/frontend directories for ad hoc testing.',['script','legacy','tooling'],'simple'],
'catalog/scripts/update-backend-part1.js':['file','Legacy one-off script that patches files in an old backend source tree.',['script','legacy','codemod'],'moderate'],
'catalog/src/middlewares/auth.middleware.test.ts':['file','Tests for the catalog auth middleware signed identity header handling.',['test','auth','middleware'],'simple'],
'frontend/next-env.d.ts':['file','Next.js generated type reference declarations.',['type-definition','nextjs','generated'],'simple'],
'frontend/next.config.mjs':['config','Next.js configuration covering build options, headers and image settings.',['configuration','nextjs','build-system'],'simple'],
'frontend/postcss.config.js':['config','PostCSS configuration enabling Tailwind CSS and autoprefixer.',['configuration','postcss','css'],'simple'],
'frontend/public/robots.txt':['document','Robots exclusion rules for search crawlers.',['seo','public-asset','configuration'],'simple'],
'frontend/src/app/dat-lai-mat-khau/layout.tsx':['file','Layout and metadata for the password reset page.',['layout','nextjs','auth','page'],'simple'],
'frontend/src/app/globals.css':['file','Global stylesheet with Tailwind layers, theme CSS variables and shared component styles.',['css','styling','theme','global'],'complex'],
'frontend/src/app/xac-thuc-email/layout.tsx':['file','Layout and metadata for the email verification page.',['layout','nextjs','auth','page'],'simple'],
'frontend/tailwind.config.ts':['file','Tailwind configuration building themed color scales from CSS variables.',['configuration','tailwind','theme','styling'],'moderate'],
'frontend/tsconfig.tsbuildinfo':['config','Generated TypeScript incremental build cache.',['generated','build-cache','typescript'],'simple'],
'launch.py':['file','Main launcher that generates .env, syncs the Postgres password, builds, migrates, seeds, starts the crawler and runs health checks via Docker Compose.',['entry-point','script','deployment','orchestration'],'complex'],
'nginx/nginx.conf':['config','Gateway nginx configuration routing traffic to the frontend, catalog and microservice upstreams with rate limiting and WebSocket support.',['configuration','gateway','routing','infrastructure'],'complex'],
'postgres/provision.sh':['file','One-shot db-init script giving each service its own database and login role idempotently.',['script','database','provisioning','docker'],'simple'],
'scripts/auth-smoke.py':['file','Smoke test of register, login, session and password flows through the gateway.',['test','smoke','auth','script'],'moderate'],
'scripts/bench.mjs':['file','Latency benchmark hitting main reader paths and printing p50/p95/max.',['script','benchmark','performance'],'simple'],
'scripts/community-smoke.py':['file','Smoke test of the community service (posts, reactions, comments) through the gateway.',['test','smoke','community','script'],'moderate'],
'scripts/crawler.py':['file','Crawler importing manga and novels from MangaDex, TopTruyen and Valvrare into the database, with locking, status reporting and cover handling.',['crawler','script','import','data-pipeline'],'complex'],
'scripts/launch.py':['file','Shortcut wrapper delegating to the project-root launch.py.',['script','entry-point','wrapper'],'simple'],
'scripts/library-smoke.py':['file','Smoke test of library features such as follows and reading history.',['test','smoke','library','script'],'moderate'],
'scripts/recommender-smoke.py':['file','Smoke test of the recommender behaviour including guest follow and view rows.',['test','smoke','recommender','script'],'moderate'],
'scripts/workspace-smoke.py':['file','Smoke test of the translation workspace flows (assign, submit, review, notifications).',['test','smoke','workspace','script'],'complex'],
'services/community/package.json':['config','npm manifest for the community service.',['configuration','npm','community'],'simple'],
'services/community/seed/demo.sql':['file','Seed SQL adding demo Fandom posts, reactions, comments and a report once into an empty community database.',['database','seed','demo','sql'],'simple'],
'services/community/src/auth.test.ts':['file','Tests for the community service signed user header authentication.',['test','auth','community'],'simple'],
'services/community/tsconfig.json':['config','TypeScript compiler configuration for the community service.',['configuration','typescript','community'],'simple'],
'services/identity/admin.go':['file','Admin HTTP handlers of the identity service for role changes, bans, user deletion, lookup and session revocation.',['api-handler','admin','identity','go'],'complex'],
'services/identity/auth.go':['file','Core auth handlers of the identity service: register, login, logout, sessions, password change/reset and email verification.',['api-handler','auth','identity','go'],'complex'],
'services/identity/config.go':['file','Loads identity service configuration from environment variables.',['configuration','identity','go'],'simple'],
'services/identity/db.go':['file','Creates and migrates the identity database schema.',['database','migration','identity','go'],'simple'],
'services/identity/demo.go':['file','Seeds demo accounts into the identity database.',['seed','demo','identity','go'],'simple'],
'services/identity/email.go':['file','Email change request and confirmation handlers plus a human-check helper.',['api-handler','email','identity','go'],'moderate'],
'services/identity/events.go':['file','Transactional outbox for user events: enqueue, publish loop to RabbitMQ, republish and stats endpoint.',['events','outbox','messaging','identity','go'],'complex'],
};
const F={
'catalog/scripts/check-db.ts':{checkDatabase:'Connects to the database and reports table counts and health.'},
'catalog/scripts/import-from-docmep.ts':{importFromDocmep:'Imports stories, chapters and assets from the legacy Docmep source into the catalog database.',slugify:'Converts a title into a URL slug.',ensureDir:'Creates a directory if missing.',copyFileSafe:'Copies a file, creating parents and tolerating failures.'},
'catalog/scripts/import-sql.ts':{importSql:'Reads a SQL file and runs it against the database.'},
'launch.py':{ensure_env:'Generates or completes the .env file with secrets and defaults.',run_checks:'Runs post-start health checks against containers and gateway endpoints.',apply_migrations:'Applies SQL migrations to the databases.',main:'Entry point orchestrating the full launch sequence.',sync_postgres_password:'Aligns the Postgres role password with .env.',pull_latest:'Pulls latest git changes when safe.',source_fingerprint:'Hashes source files to decide whether a rebuild is needed.',start_crawler:'Starts the manga crawler process.',read_env:'Parses the .env file.',set_env_values:'Updates keys in the .env file.',check_ports:'Verifies required host ports are free.',compose:'Runs docker compose with project settings.',wait_until:'Polls a condition until timeout.',http:'Small HTTP request helper.',container_states:'Reads container states from Docker.',build_state:'Computes whether a build is needed from stamps.',seed_accounts:'Seeds demo accounts.'},
'scripts/crawler.py':{main:'CLI entry point handling crawl, status and stop options.',Importer:'Imports crawled stories and chapters into the database and media folders.',Http:'HTTP client with retries, rate limits and blocking detection.',MangaDex:'Source adapter for the MangaDex API.',TopTruyen:'Source adapter for TopTruyen pages.',Valvrare:'Source adapter for Valvrare novels.',ParagraphParser:'HTML parser extracting paragraph text.',image_size:'Reads image dimensions from bytes.',enable_random_downloads:'Enables downloads on random imported stories.',fill_missing_covers:'Fills missing covers from first chapter images.',acquire_lock:'Takes the single-instance crawler lock, stopping older crawlers.',stop_process:'Terminates a running crawler process.',print_status:'Prints crawler progress and errors.',psql:'Runs a SQL statement through psql in the database container.',q:'Quotes a value as a SQL literal.',compress_folder:'Compresses a chapter folder.',read_status:'Reads the crawler status file.',pid_alive:'Checks whether a PID is alive.',is_crawler:'Checks whether a PID is a crawler process.',env_value:'Reads a value from .env.',slugify:'Builds a slug from text.',starting_views:'Picks a random initial view count.',give_views_to_unviewed:'Assigns views to stories with none.',release_lock:'Releases the crawler lock.',Blocked:'Exception raised when a source blocks requests.'},
'scripts/auth-smoke.py':{Client:'Cookie and CSRF aware HTTP client for smoke tests.'},
'scripts/community-smoke.py':{Client:'Cookie and CSRF aware HTTP client for smoke tests.',eventually:'Retries an assertion until it passes or times out.'},
'scripts/library-smoke.py':{Client:'Cookie and CSRF aware HTTP client for smoke tests.',eventually:'Retries an assertion until it passes or times out.'},
'scripts/recommender-smoke.py':{Client:'Cookie and CSRF aware HTTP client for smoke tests.',eventually:'Retries an assertion until it passes or times out.'},
'scripts/workspace-smoke.py':{Client:'Cookie and CSRF aware HTTP client for smoke tests.',eventually:'Retries an assertion until it passes or times out.',has_notification:'Checks whether a user received a notification.'},
'frontend/tailwind.config.ts':{paletteVars:'Builds color scale entries mapped to CSS variables.',themedScale:'Creates a themed color scale.'},
'frontend/src/app/dat-lai-mat-khau/layout.tsx':{Layout:'Pass-through layout for the password reset route.'},
'frontend/src/app/xac-thuc-email/layout.tsx':{Layout:'Pass-through layout for the email verification route.'},
'services/identity/admin.go':{handleRoles:'Handler changing a user role set with moderation rights checks.',handleBan:'Handler banning or unbanning a user and revoking sessions.',handleDeleteUser:'Handler deleting a user after checks including catalog delete check.',handleLookup:'Handler looking up users for admins.',handlePrivate:'Handler for private user data access.',handleRevokeAll:'Handler revoking all sessions of a user.',backendDeleteCheck:'Asks the catalog whether a user can be deleted.',moderationRights:'Computes which roles an actor may grant.',loadTarget:'Loads the target user of an admin action.',confirmPassword:'Verifies the admin password for sensitive actions.',has:'Checks role membership.'},
'services/identity/auth.go':{handleRegister:'Registers an account with password policy and verification mail.',handleLogin:'Authenticates credentials, enforces throttling and creates a session.',handleLogout:'Ends the current session.',handleLogoutAll:'Ends all sessions of the user.',handleMe:'Returns the current user view.',handleSessions:'Lists the user sessions.',handleRevokeSession:'Revokes one session.',createAccountToken:'Creates a one-time account token.',consumeAccountToken:'Validates and consumes an account token.',handleChangePassword:'Changes password and revokes other sessions.',handleForgot:'Starts the forgot password flow by mail.',handleReset:'Completes password reset with a token.',handleVerifyEmail:'Verifies an email address token.',handleResendVerification:'Resends the verification mail.',loadUserView:'Loads the user with roles for responses.',passwordChangedMail:'Builds the password changed notice mail.'},
'services/identity/config.go':{loadConfig:'Reads configuration from environment into config.',env:'Reads an environment variable with a default.'},
'services/identity/db.go':{migrate:'Creates identity tables and indexes.'},
'services/identity/demo.go':{seedDemo:'Seeds demo accounts.'},
'services/identity/email.go':{handleChangeEmail:'Starts an email change with confirmation mail.',handleConfirmEmailChange:'Confirms an email change token.',humanOK:'Checks a human verification answer.'},
'services/identity/events.go':{enqueueEvent:'Inserts a user event in the outbox.',publishLoop:'Background loop publishing outbox events.',publishSession:'Publishes events in a session.',publishBatch:'Publishes a batch of events to RabbitMQ.',republish:'Republishes events on demand.',handleStats:'Reports outbox stats.',userEvent:'Builds a user event payload.',alert:'Logs an alert for failures.'},
};
for(const i of [33,34,35,36,37,38]){
 const inp=JSON.parse(fs.readFileSync(`ua-file-analyzer-input-${i}.json`));
 let ext={};try{for(const r of JSON.parse(fs.readFileSync(`ua-file-extract-results-${i}.json`)).results)ext[r.path]=r}catch(e){}
 const nodes=[],edges=[];
 for(const f of inp.batchFiles){
  const p=f.path;const t=p.endsWith('.webp')?['file','Tutorial screenshot image (WebP) for the translator workflow guide: '+p.split('/').pop().replace('.webp','')+'.',['image','asset','tutorial','public-asset'],'simple']:T[p];if(!t)throw new Error('missing '+p);
  const type=t[0];
  nodes.push({id:`${type}:${p}`,type,name:p.split('/').pop(),filePath:p,summary:t[1],tags:t[2],complexity:t[3]});
  const r=ext[p];if(!r)continue;
  const fm=F[p]||{};
  const items=[];
  for(const fn of r.functions||[]){const n=fn.endLine-fn.startLine+1;const ex=(r.exports||[]).some(e=>e.name===fn.name);if(n>=10||ex)items.push(['function',fn]);}
  for(const c of r.classes||[]) items.push(['class',c]);
  const seen=new Set();
  for(const [k,x] of items){
   if(seen.has(k+x.name))continue;seen.add(k+x.name);
   const n=x.endLine-x.startLine+1;
   if(k==='class'&&!((x.methods||[]).length>=2||n>=20||(r.exports||[]).some(e=>e.name===x.name)))continue;
   const id=`${k}:${p}:${x.name}`;
   nodes.push({id,type:k,name:x.name,filePath:p,lineRange:[x.startLine,x.endLine],summary:fm[x.name]||`${k==='class'?'Class':'Helper'} ${x.name} in ${p.split('/').pop()}.`,tags:[k==='class'?'class':'helper','logic','implementation'],complexity:n>60?'complex':n>20?'moderate':'simple'});
   edges.push({source:`${type}:${p}`,target:id,type:'contains',direction:'forward',weight:1.0});
  }
 }
 const add=(s,t,ty,w)=>edges.push({source:s,target:t,type:ty,direction:'forward',weight:w});
 if(i===33){add('config:frontend/tsconfig.json','file:frontend/next-env.d.ts','configures',0.6);add('config:frontend/.env.example','config:frontend/.env.local','related',0.5);}
 if(i===34){add('document:scripts/README.md','file:scripts/migrate.sh','documents',0.5);add('document:scripts/README.md','file:scripts/new-branch.sh','documents',0.5);add('document:scripts/README.md','file:scripts/check-nav.sh','documents',0.5);}
 if(i===35){add('config:services/identity/go.mod','config:services/identity/go.sum','related',0.5);}
 if(i===36){add('config:services/media/package.json','config:services/media/tsconfig.json','related',0.5);add('file:services/media/docker-entrypoint.sh','config:services/media/package.json','related',0.5);}
 if(i===37){add('file:frontend/src/app/globals.css','config:frontend/postcss.config.js','related',0.5);add('config:frontend/next.config.mjs','file:frontend/src/app/dat-lai-mat-khau/layout.tsx','configures',0.6);}
 if(i===38){add('file:scripts/launch.py','file:launch.py','depends_on',0.6);add('file:frontend/tailwind.config.ts','file:frontend/src/app/globals.css','related',0.5);add('file:services/identity/auth.go','file:services/identity/db.go','depends_on',0.6);add('file:services/identity/auth.go','file:services/identity/config.go','depends_on',0.6);add('file:services/identity/demo.go','file:services/identity/db.go','depends_on',0.6);add('file:services/identity/events.go','file:services/identity/auth.go','related',0.5);}
 const files=[...new Set(nodes.map(n=>n.filePath))].sort();const parts=Math.ceil(Math.max(nodes.length/60,edges.length/120));if(parts<=1)fs.writeFileSync('../intermediate/batch-'+i+'.json',JSON.stringify({nodes,edges},null,1));else{const sz=Math.ceil(files.length/parts);for(let k=0;k<parts;k++){const fs2=new Set(files.slice(k*sz,(k+1)*sz));const nn=nodes.filter(n=>fs2.has(n.filePath));const ids=new Set(nn.map(n=>n.id));fs.writeFileSync('../intermediate/batch-'+i+'-part-'+(k+1)+'.json',JSON.stringify({nodes:nn,edges:edges.filter(e=>ids.has(e.source))},null,1));}}
 console.log(i,nodes.length,edges.length);
}

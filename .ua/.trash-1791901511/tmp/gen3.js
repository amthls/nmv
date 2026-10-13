const fs=require('fs');
const T=__dirname, O=T+'/../intermediate/';
const g=require(T+'/group-3.json');
const base=p=>p.split('/').pop();
const S={};
const F=(p,s,t,c,fns,cls)=>S[p]={s,t,c,fns:fns||{},cls:cls||{}};
// batch 8
F('services/media/src/auth.ts','Authentication helpers for the media service: verifies HMAC-signed X-User headers, offers optional/required auth middleware, calls the catalog backend, and defines rate limiters for uploads, resizes and exports.',['auth','middleware','rate-limiting','security'],'moderate',{
 userFromHeaders:['Parses and verifies the signed X-User-* gateway headers into a user object.',['auth','security','parsing']],
 callBackend:['Performs a signed internal request to the catalog backend.',['http-client','internal-api','security']],
 requireAuth:['Express middleware that rejects unauthenticated requests.',['middleware','auth','express']],
 optionalAuth:['Express middleware that attaches the user when headers are valid but allows anonymous access.',['middleware','auth','express']],
 isContributor:['Checks with the backend whether the user may contribute or upload content.',['authorization','backend-call','security']]});
F('services/media/src/config.ts','Loads media service environment configuration (ports, keys, storage directories), creates the Postgres pool and runs the service migrations.',['configuration','database','environment','migration'],'simple',{migrate:['Applies the media service SQL migrations on startup.',['migration','database','startup']]});
F('services/media/src/export/content.ts','Fetches and prepares chapter images for export, including SSRF protection that only allows public hosts and local upload resolution.',['export','image-processing','security','ssrf-protection'],'moderate',{
 fetchRemote:['Downloads a remote image with public-IP checks and size/time limits.',['http-client','security','ssrf-protection']],
 prepareImage:['Normalizes an image (decode, resize, recompress) into a format embeddable in EPUB or PDF.',['image-processing','export','sharp']],
 fetchImage:['Returns image bytes from the local upload store or from a remote URL.',['image','export','io']],
 isPublicHost:['Resolves a hostname and checks that it points to a public address.',['security','dns','validation']],
 isPublicIp:['Tests whether an IP address is public rather than private or loopback.',['security','network','validation']],
 localUpload:['Maps an upload URL path to a file path under the upload directory.',['path-resolution','uploads','security']]});
F('services/media/src/export/epub.ts','Generates EPUB books from story chapters with XHTML pages, table of contents, NCX navigation, embedded fonts and covers, written through a streaming zip writer.',['epub','export','ebook','generator'],'complex',{
 writeEpub:['Builds a complete EPUB package (container, OPF manifest, nav, chapters, images, fonts) and streams it to disk.',['epub','generator','export']],
 buildToc:['Builds the hierarchical table of contents for the EPUB.',['epub','toc','navigation']],
 xhtml:['Wraps chapter content into a valid XHTML document.',['epub','markup','template']],
 esc:['Escapes text for safe XML/HTML output.',['utility','escaping','xml']]});
F('services/media/src/export/index.ts','Export job orchestrator: validates requests, queues EPUB/PDF/ZIP export jobs in Postgres, runs a background processing loop, recovers interrupted jobs and cleans up expired files.',['export','job-queue','orchestration','background-worker'],'complex',{
 requestExport:['Validates and enqueues a new export request for a story or manga source with limits and de-duplication.',['export','validation','job-queue']],
 processExport:['Loads book data and renders the requested format, updating job progress and status.',['export','worker','pipeline']],
 exportLoop:['Background loop that picks pending export jobs and processes them.',['background-worker','job-queue','loop']],
 recoverExports:['Resets export jobs left running after a restart.',['recovery','job-queue','startup']],
 cleanupExports:['Deletes expired export files and records.',['cleanup','maintenance','scheduler']],
 loadBook:['Loads the book content for an export from the source.',['export','data-loading','database']],
 safeFileName:['Builds a filesystem and header-safe download file name.',['utility','sanitization','filename']],
 uuidFrom:['Derives a deterministic UUID from a string, for stable identifiers.',['utility','uuid','hashing']],
 exportSource:['Resolves the export source (story or manga).',['export','source','config']],
 wakeExportLoop:['Wakes the export loop so new jobs are processed promptly.',['background-worker','signal','export']],
 exportsActive:['Reports whether export jobs are currently being processed.',['status','export','monitoring']]},{
 ExportRequestError:['Error class carrying an HTTP status for invalid export requests.',['error','validation','export']]});
F('services/media/src/export/pdf.ts','Renders PDF books from chapter text and images with layout, outline bookmarks and multi-font text handling.',['pdf','export','generator','typography'],'complex',{
 writePdf:['Lays out cover, chapters, text and images into a PDF and writes it to disk.',['pdf','generator','layout']],
 addOutline:['Adds bookmark outline entries to the PDF.',['pdf','navigation','outline']],
 relieve:['Yields to the event loop to avoid blocking during long PDF generation.',['async','utility','event-loop']]});
F('services/media/src/export/pdfText.ts','Font selection and text-run splitting for PDF output, falling back across fonts to cover CJK and symbol glyphs.',['pdf','fonts','text-layout','unicode'],'moderate',{
 splitRuns:['Splits text into runs by the font that covers each character.',['text','fonts','unicode']],
 textWriter:['Creates a text writer that wraps and draws mixed-font text onto PDF pages.',['pdf','text-layout','fonts']],
 openFont:['Opens a font file for glyph measurement and embedding.',['fonts','io','pdf']],
 coverage:['Tests whether a font covers a character.',['fonts','unicode','glyphs']],
 primaryFont:['Selects the primary font for a given character.',['fonts','selection','glyphs']]});
F('services/media/src/export/zip.ts','Minimal streaming ZIP writer with DOS timestamps and CRC handling, used to assemble EPUB packages and archive exports.',['zip','archive','streaming','export'],'moderate',{},{ZipWriter:['Streams entries into a ZIP file, tracking offsets and writing the central directory.',['zip','streaming','writer']]});
F('services/media/src/exportRoutes.ts','Express handlers for creating an export job, polling its status and downloading the finished file with a safe Content-Disposition.',['api-handler','export','express','routes'],'moderate',{
 createExport:['Handles POST to create an export job.',['api-handler','export','express']],
 getExport:['Returns the status of an export job.',['api-handler','export','express']],
 downloadExport:['Streams a finished export file with download headers.',['api-handler','download','express']],
 serialize:['Converts an export job row to its API response shape.',['serialization','export','api']],
 contentDisposition:['Builds an RFC 5987 Content-Disposition header value.',['http','utility','headers']]});
F('services/media/src/image.ts','Image resizing service using sharp that produces width variants of uploaded images with a concurrency-limited resize queue.',['image-processing','sharp','resize','concurrency'],'moderate',{
 resizeUploadedImage:['Resizes an uploaded image to a requested width, caching the variant.',['image-processing','caching','resize']],
 buildVariant:['Generates and stores a resized variant file.',['image-processing','resize','cache']],
 withResizeSlot:['Limits concurrent resize operations using a slot semaphore.',['concurrency','throttling','semaphore']],
 readImageSize:['Reads width and height of an image.',['image','metadata','sharp']],
 resolveUpload:['Resolves an upload path safely under the upload directory.',['path-resolution','security','uploads']]});
F('services/media/src/logger.ts','Structured JSON logger with per-request AsyncLocalStorage context, request IDs and secret redaction.',['logging','observability','middleware','redaction'],'simple',{
 requestContext:['Middleware establishing request ID context and access logging.',['middleware','observability','logging']],
 redact:['Redacts sensitive values from log data.',['security','logging','redaction']],
 log:['Writes a structured log line.',['logging','observability','json']],
 currentRequestId:['Returns the request ID from async context.',['context','tracing','logging']]});
F('services/media/src/server.ts','Entry point of the media service Express app: wires logging, auth, upload, image, and export routes, runs migrations and starts the export loop plus healthcheck mode.',['entry-point','server','express','media-service'],'moderate',{main:['Boots the media service: migrates, registers routes and starts listening.',['bootstrap','entry-point','server']]});
F('services/media/src/upload.ts','Upload handlers for single images, multiple images and manga pages with real-image validation, and database registration of uploaded files.',['upload','api-handler','validation','images'],'moderate',{
 uploadMangaPages:['Handles manga page uploads, validates images and stores ordered pages.',['upload','manga','api-handler']],
 uploadSingleImage:['Handles a single image upload and returns its URL.',['upload','api-handler','images']],
 uploadMultipleImages:['Handles multi-image uploads.',['upload','api-handler','images']],
 keepOnlyRealImages:['Removes uploaded files that are not valid images.',['validation','security','images']]});
F('services/media/src/uploadFiles.ts','Multer configuration for image and manga page uploads with disk storage, MIME filtering and size limits.',['upload','multer','configuration','validation'],'simple',{fileFilter:['Multer filter that accepts only allowed image MIME types.',['validation','upload','multer']]});
// batch 9
F('frontend/src/app/kham-pha/page.tsx','Explore page with search, filter sidebar, sorting, grid/list toggle and pagination of stories, driven by URL query parameters.',['page','explore','filters','nextjs'],'complex',{
 ExplorePageContent:['Client component managing explore filters, URL sync, fetching, and rendering the result grid or list.',['component','state-management','data-fetching']],
 ExplorePage:['Page wrapper rendering the content inside Suspense.',['page','suspense','nextjs']]});
F('frontend/src/app/moi-cap-nhat/page.tsx','Recently updated stories page that renders the shared sorted stories listing.',['page','nextjs','listing'],'simple',{RecentlyUpdatedPage:['Page component for stories sorted by last update.',['page','nextjs','listing']]});
F('frontend/src/app/nhieu-nguoi-xem/page.tsx','Most viewed stories page that renders the shared sorted stories listing.',['page','nextjs','listing'],'simple',{MostViewedPage:['Page component for stories sorted by views.',['page','nextjs','listing']]});
F('frontend/src/app/page.tsx','Home page that fetches story lists and renders the featured carousel, story rails and recommendations.',['page','home','nextjs','server-component'],'simple',{HomePage:['Home page composing carousel, rails and recommendation sections.',['page','home','nextjs']],getList:['Fetches a story list from the API for a home section.',['data-fetching','api','home']]});
F('frontend/src/components/explore/FilterSidebar.tsx','Sidebar with genre, status, type and other filters for the explore page.',['component','filters','ui','explore'],'complex',{FilterSidebar:['Renders filter controls and reports filter changes.',['component','filters','ui']]});
F('frontend/src/components/explore/Pagination.tsx','Pagination control with page numbers and previous/next buttons.',['component','pagination','ui'],'moderate',{Pagination:['Renders page navigation with ellipsis windows.',['component','pagination','ui']]});
F('frontend/src/components/explore/SortedStoriesPage.tsx','Reusable client page that loads a fixed-sort story list with grid and pagination.',['component','listing','data-fetching','pagination'],'moderate',{SortedStoriesPage:['Fetches paginated stories for a given sort and displays them in an auto-column grid.',['component','data-fetching','listing']]});
F('frontend/src/components/explore/StoryCardGrid.tsx','Story card grid component plus count and relative-time formatters shared across listings.',['component','grid','formatting','ui'],'moderate',{StoryCardGrid:['Renders story cards in a responsive grid.',['component','grid','ui']],formatCount:['Formats large numbers compactly.',['formatting','utility','numbers']],formatTimeAgo:['Formats a timestamp as relative time in Vietnamese.',['formatting','utility','time']]});
F('frontend/src/components/explore/StoryCardList.tsx','Horizontal list-view story card with cover, rich-text description and stats.',['component','list-view','ui'],'moderate',{StoryCardList:['Renders stories as a detailed list.',['component','list-view','ui']]});
F('frontend/src/components/home/FeaturedCarousel.tsx','Auto-advancing featured story carousel on the home page with artwork selection and controls.',['component','carousel','home','ui'],'complex',{FeaturedCarousel:['Carousel with timer and dot navigation for featured stories.',['component','carousel','home']],pickArtwork:['Picks the best banner artwork for a story.',['utility','images','selection']]});
F('frontend/src/components/home/RecommendationRail.tsx','Home rail showing personalized recommendations for the logged-in user.',['component','recommendations','home','data-fetching'],'moderate',{RecommendationRail:['Fetches recommendations when authenticated and renders them in a rail.',['component','recommendations','home']]});
F('frontend/src/components/home/StoryRail.tsx','Horizontal scrolling rail of story cards with a title and see-all link.',['component','rail','home','ui'],'moderate',{StoryRail:['Renders a titled horizontally scrolling story rail.',['component','rail','home']]});
F('frontend/src/lib/useAutoColumns.ts','Hook computing a responsive column count from container width and a minimum card size.',['hook','responsive','layout'],'simple',{useAutoColumns:['Observes container width to compute grid column count.',['hook','resize-observer','layout']],columnsStyle:['Builds the CSS grid style for a column count.',['css','utility','layout']]});
// batch 10
F('services/recommender/rec/__init__.py','Empty package marker for the recommender service.',['package','python','recommender'],'simple');
F('services/recommender/rec/__main__.py','Command-line entry point dispatching recommender modes such as serve, train, ingest and migrate.',['entry-point','cli','python','recommender'],'simple',{main:['Parses the mode argument and runs the corresponding recommender task.',['cli','entry-point','dispatch']]});
F('services/recommender/rec/api.py','HTTP API of the recommender with health, home, related and training endpoints plus a background training loop.',['api','http','recommender','python'],'moderate',{create_app:['Builds the HTTP application with routes, auth and background loops.',['api','factory','http']],run_training:['Runs a training cycle in a worker thread.',['training','background','worker']],train_loop:['Periodically triggers model retraining.',['background','scheduler','training']]},{Fail:['Exception carrying an HTTP status for API errors.',['error','http','exception']]});
F('services/recommender/rec/common.py','Shared recommender utilities: configuration from env, logging, DB pool and migrations, signed internal headers, user header verification and catalog calls.',['utility','configuration','database','security'],'moderate',{
 call:['Makes a signed internal HTTP call to another service.',['http-client','security','internal-api']],user_from:['Verifies signed user headers and returns the user.',['auth','security','headers']],migrate:['Applies recommender SQL migrations.',['migration','database','startup']],internal_header:['Builds the signed internal key header.',['security','headers','internal-api']],make_pool:['Creates the Postgres connection pool.',['database','pool','postgres']],log:['Emits structured log lines.',['logging','observability','json']],data_of:['Extracts the data payload from a service response.',['utility','parsing','response']],connect:['Opens a database connection from the pool.',['database','connection','postgres']]},{Config:['Environment-driven configuration holder.',['configuration','environment','dataclass']]});
F('services/recommender/rec/ingest.py','Ingests catalog and library data into the recommender: syncs stories, consumes event streams idempotently and imports legacy history.',['ingestion','events','synchronization','python'],'complex',{
 _consume:['Consumes events from a queue and applies them in order idempotently.',['events','consumer','messaging']],apply_event:['Applies a single event to recommender tables.',['events','database','idempotency']],import_legacy:['Imports legacy reading history into events.',['migration','import','legacy']],sync_stories:['Pulls story metadata from the catalog.',['sync','http-client','catalog']],reconcile_stories:['Reconciles stored stories against the catalog.',['sync','reconciliation','catalog']],sync_loop:['Background loop for periodic story sync.',['background','loop','sync']],consume_loop:['Background loop that keeps the event consumer alive.',['background','events','loop']]});
F('services/recommender/rec/serve.py','Serving logic for the recommender: builds home rails and related-story lists from precomputed scores, user history and session candidates.',['recommendation','serving','ranking','python'],'complex',{
 home:['Assembles personalized home recommendation rails for a user.',['recommendation','personalization','home']],related:['Returns stories related to a given story using precomputed scores and fallbacks.',['recommendation','ranking','related']],session_candidates:['Builds candidates from recent session activity.',['recommendation','session','candidates']],recent_stories:['Loads recently read stories.',['history','database','reading']],library_history:['Loads library and history signals.',['history','library','signals']],read_stories:['Loads stories a user already read.',['history','database','reading']],cards:['Formats story rows into cards.',['serialization','cards','formatting']]});
F('services/recommender/rec/train.py','Offline training for the recommender: builds datasets, computes user and related-story scores, tunes blend weights by evaluation and writes results.',['training','machine-learning','ranking','python'],'complex',{
 train:['Runs the full training pipeline.',['training','pipeline','orchestration']],load_dataset:['Loads interaction data and builds the model dataset.',['data-loading','dataset','database']],evaluate_and_tune:['Evaluates candidate weights on held-out data and picks the best.',['evaluation','tuning','metrics']],blend_actor:['Blends actor score components.',['scoring','blending','ranking']],actor_components:['Computes per-actor score components.',['scoring','ranking','features']],diversify:['Re-ranks results for diversity.',['ranking','diversity','postprocessing']],related_rows:['Builds related-story rows for storage.',['scoring','related','rows']],user_rows:['Builds per-user recommendation rows.',['scoring','users','rows']],write_results:['Writes scores to the database.',['database','persistence','results']],main:['CLI entry point for training.',['entry-point','cli','training']],preference:['Computes user preference weight from an interaction.',['scoring','preference','features']]},{Model:['Container for trained model state.',['model','data-structure','training']]});
F('services/recommender/tests/test_rec.py','Tests covering signature checks, small algorithm behaviour, idempotent ordered event ingestion, training and the HTTP API against a test database.',['test','pytest','recommender','integration-test'],'moderate',{test_api:['End-to-end test of API endpoints.',['test','api','integration']],test_training:['Tests that training produces results.',['test','training','integration']],test_events_idempotent_and_ordered:['Tests event application is idempotent and ordered.',['test','events','idempotency']]});
const spec={
 11:{docker:'catalog/Dockerfile',ign:'catalog/.dockerignore',ds:'Multi-stage Docker build for the catalog Express/Prisma service: builder compiles TypeScript and generates the Prisma client, runner installs production deps with an entrypoint that fixes mount permissions.',tags:['containerization','infrastructure','multi-stage','nodejs'],c:'moderate',is:'Dockerignore excluding node_modules, dist, env and logs from the catalog build context.'},
 12:{docker:'frontend/Dockerfile',ign:'frontend/.dockerignore',ds:'Multi-stage Docker build for the Next.js frontend with build-time public API URL and Turnstile site key, running as non-root node user on port 3000.',tags:['containerization','infrastructure','nextjs','deployment'],c:'moderate',is:'Dockerignore excluding node_modules, .next and local env files from the frontend build context.'},
 13:{docker:'services/community/Dockerfile',ign:'services/community/.dockerignore',ds:'Multi-stage Docker build for the community Node service with production-only dependencies, bundled migrations, healthcheck and non-root user.',tags:['containerization','infrastructure','healthcheck','nodejs'],c:'simple',is:'Dockerignore excluding node_modules and dist for the community service.'},
 14:{docker:'services/identity/Dockerfile',ign:'services/identity/.dockerignore',ds:'Multi-stage Go build producing a static identity binary in a scratch image with CA certificates, running as nobody with a healthcheck.',tags:['containerization','infrastructure','golang','minimal-image'],c:'simple',is:'Dockerignore excluding the Dockerfile and Go test files from the identity build context.'},
 15:{docker:'services/library/Dockerfile',ds:'Multi-stage Go build producing a static library service binary in a scratch image, running as nobody with a healthcheck.',tags:['containerization','infrastructure','golang','minimal-image'],c:'simple'},
 16:{docker:'services/media/Dockerfile',ign:'services/media/.dockerignore',ds:'Multi-stage Docker build for the media service adding CJK and DejaVu fonts for EPUB/PDF export, assets, migrations and a root-then-node entrypoint fixing mount permissions.',tags:['containerization','infrastructure','fonts','nodejs'],c:'moderate',is:'Dockerignore excluding node_modules and dist for the media service.',deploys:'file:services/media/src/server.ts'}
};
for(const b of g.batches){
 const r=require(T+'/ua-file-extract-results-'+b.batchIndex+'.json');
 const nodes=[],edges=[];
 const E=(s,t,ty,w)=>edges.push({source:s,target:t,type:ty,direction:'forward',weight:w});
 const sp=spec[b.batchIndex];
 if(sp){
  nodes.push({id:'service:'+sp.docker,type:'service',name:'Dockerfile',filePath:sp.docker,summary:sp.ds,tags:sp.tags,complexity:sp.c});
  if(sp.ign){nodes.push({id:'config:'+sp.ign,type:'config',name:'.dockerignore',filePath:sp.ign,summary:sp.is,tags:['configuration','docker','build-context'],complexity:'simple'});
   E('config:'+sp.ign,'service:'+sp.docker,'configures',0.6);}
  if(sp.deploys)E('service:'+sp.docker,sp.deploys,'deploys',0.7);
 }else for(const f of r.results){
  const s=S[f.path]; if(!s)throw new Error('nospec '+f.path);
  const fid='file:'+f.path;
  const isTest=/test_/.test(f.path);
  nodes.push({id:fid,type:'file',name:base(f.path),filePath:f.path,summary:s.s,tags:s.t,complexity:s.c});
  for(const fn of f.functions||[]){const d=s.fns[fn.name];if(!d)continue;
   const id='function:'+f.path+':'+fn.name;
   const len=fn.endLine-fn.startLine;
   nodes.push({id,type:'function',name:fn.name,filePath:f.path,lineRange:[fn.startLine,fn.endLine],summary:d[0],tags:d[1],complexity:len>80?'complex':len>25?'moderate':'simple'});
   E(fid,id,'contains',1.0);
   if((f.exports||[]).some(e=>e.name===fn.name))E(fid,id,'exports',0.8);}
  for(const cl of f.classes||[]){const d=s.cls[cl.name];if(!d)continue;
   const id='class:'+f.path+':'+cl.name;
   nodes.push({id,type:'class',name:cl.name,filePath:f.path,lineRange:[cl.startLine,cl.endLine],summary:d[0],tags:d[1],complexity:(cl.endLine-cl.startLine)>60?'moderate':'simple'});
   E(fid,id,'contains',1.0);E(fid,id,'exports',0.8);}
  for(const imp of b.batchImportData[f.path]||[])E(fid,'file:'+imp,'imports',0.7);
  if(isTest)for(const imp of b.batchImportData[f.path]||[])E('file:'+imp,fid,'tested_by',0.5);
 }
 fs.writeFileSync(O+'batch-'+b.batchIndex+'.json',JSON.stringify({nodes,edges},null,1));
 const imp=Object.values(b.batchImportData).reduce((a,x)=>a+x.length,0);
 console.log(b.batchIndex,nodes.length,edges.length,'imports expected',imp,'got',edges.filter(e=>e.type==='imports').length);
}

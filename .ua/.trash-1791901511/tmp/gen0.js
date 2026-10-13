const g=require('./group-0.json');const fs=require('fs');
const S={
'frontend/src/app/dang-truyen-tranh/page.tsx':["Manga chapter upload page supporting drag-and-drop of images, folders and archives, page batching and progress reporting.",'page,manga,upload,client-component'],
'frontend/src/app/dang-truyen/page.tsx':["Page for creating a new story, wrapping StoryForm behind an auth check.",'page,story,form,next-route'],
'frontend/src/app/dang-truyen/sua/[slug]/page.tsx':["Page for editing an existing story identified by slug, loading data and rendering StoryForm.",'page,story,edit,dynamic-route'],
'frontend/src/app/huong-dan/lam-chuong/page.tsx':["Static guide page explaining the chapter-making workflow for translators and editors.",'page,documentation,guide,static'],
'frontend/src/app/loading.tsx':["Root Next.js loading boundary that renders the shared PageLoader.",'page,loading,next-route'],
'frontend/src/app/nhom-dich/[slug]/page.tsx':["Translation group detail page with members, stories, tasks, assignments and realtime updates.",'page,group,workspace,realtime'],
'frontend/src/app/thong-tin/page.tsx':["Static information page about the site.",'page,static,info,next-route'],
'frontend/src/app/tin-nhan/page.tsx':["Messages inbox page with search, labels, highlighting and realtime updates, including draft cards.",'page,messaging,realtime,labels'],
'frontend/src/app/truyen/[slug]/lich-su/[chapterId]/page.tsx':["Chapter revision history page showing block-level diffs between versions.",'page,history,diff,dynamic-route'],
'frontend/src/app/ws/de-xuat/[id]/page.tsx':["Workspace proposal page showing a proposed chapter change with diff and draft rows.",'page,workspace,proposal,diff'],
'frontend/src/app/ws/nhom/[slug]/page.tsx':["Group workspace page listing tasks, drafts and workflow steps for a translation group.",'page,workspace,group,tasks'],
'frontend/src/app/ws/page.tsx':["Workspace home page aggregating the user tasks, drafts and story flows.",'page,workspace,dashboard,tasks'],
'frontend/src/app/ws/truyen/[slug]/page.tsx':["Per-story workspace page with assignments, tasks and drafts.",'page,workspace,story,tasks'],
'frontend/src/app/xac-thuc-email/page.tsx':["Email verification page that confirms a token inside an account card.",'page,auth,email-verification,suspense'],
'frontend/src/components/common/BackLink.tsx':["Navigation helpers BackLink and BackButton that go back based on the in-site history stack from nav.ts.",'component,navigation,back-link,client-component'],
'frontend/src/components/common/Link.tsx':["Wrapper around next/link that prefetches only on hover or touch, used project-wide instead of next/link.",'component,link,navigation,prefetch'],
'frontend/src/components/common/PageLoader.tsx':["Full-page loading indicator built on BookLoader.",'component,loading,ui'],
'frontend/src/components/messages/LabelManager.tsx':["Modal UI for creating, coloring and deleting message labels.",'component,messaging,labels,form'],
'frontend/src/components/messages/labels.ts':["Helper that computes inline styling for a message label color.",'utility,labels,styling'],
'frontend/src/components/reader/ChapterSelectorModal.tsx':["Modal listing chapters of a story so readers can jump to one.",'component,reader,modal,navigation'],
'frontend/src/components/story/UploadHeader.tsx':["Header for upload pages with back link and text/manga mode switch.",'component,upload,header'],
'frontend/src/components/story/UploadModeSwitch.tsx':["Tab-like switch between text and manga chapter upload modes.",'component,upload,navigation'],
'frontend/src/components/workspace/AssignForm.tsx':["Form to assign a chapter task to a workspace member, with step-by-step sections.",'component,workspace,form,assignment'],
'frontend/src/components/workspace/BlockDiff.tsx':["Word and block level diff rendering with folding of unchanged regions for chapter versions.",'component,diff,workspace,algorithm'],
'frontend/src/components/workspace/DraftCard.tsx':["Card presenting a draft with its status and link, built on DraftRow.",'component,workspace,draft,card'],
'frontend/src/components/workspace/DraftRow.tsx':["Row component showing a draft with a status label.",'component,workspace,draft,list'],
'frontend/src/components/workspace/StoryFlow.tsx':["Visualizes the chapter flow of a story and per-chapter version lists in the workspace.",'component,workspace,story,versions'],
'frontend/src/components/workspace/TaskCard.tsx':["Task card with due-date state and links in the workspace.",'component,workspace,task,card'],
'frontend/src/components/workspace/WorkflowSteps.tsx':["Renders the sequence of workflow steps as task cards.",'component,workspace,workflow'],
'frontend/src/lib/chapterUpload.ts':["Helpers deciding upload mode and building chapter upload hrefs.",'utility,upload,routing'],
'frontend/src/lib/coalesce.test.ts':["Unit tests for the coalesce helper.",'test,unit-test,coalesce'],
'frontend/src/lib/coalesce.ts':["Coalesces rapid repeated calls into one execution, used to throttle realtime refreshes.",'utility,debounce,realtime'],
'frontend/src/lib/mangaUpload.ts':["Client-side manga upload toolkit: archive extraction, folder grouping, natural sorting, image size reading, batching and page upload with UploadError.",'utility,upload,manga,archive'],
'frontend/src/lib/memo.ts':["Tiny in-memory memoization helpers with remembered and forget.",'utility,cache,memoization'],
'frontend/src/lib/realtime.ts':["WebSocket realtime client with per-tab id, visibility handling, reconnect and a useRealtime hook.",'hook,realtime,websocket,client'],
'frontend/src/app/dang-chuong/page.tsx':["Large chapter editor page: rich text editing, block conversion, image quality, share and pull dialogs, and save/publish flow.",'page,editor,chapter,complex'],
'frontend/src/app/layout.tsx':["Root layout wiring theme script, providers, Navbar, Footer, navigation tracking and miniplayer.",'layout,entry-point,providers,next-route'],
'frontend/src/app/quen-mat-khau/page.tsx':["Forgot-password page with Turnstile captcha inside an account card.",'page,auth,password-reset,captcha'],
'frontend/src/components/Footer.tsx':["Site footer with links.",'component,layout,footer'],
'frontend/src/components/Navbar.tsx':["Main navigation bar with search, notifications, auth modal, theme toggle, random story and realtime updates.",'component,navigation,navbar,realtime'],
'frontend/src/components/QuickActionModal.tsx':["Modal offering quick actions such as creating content.",'component,modal,navigation'],
'frontend/src/components/auth/AuthModal.tsx':["Login/register modal with Turnstile and AuthContext integration.",'component,auth,modal,form'],
'frontend/src/components/auth/Turnstile.tsx':["Loads Cloudflare Turnstile script and renders the captcha widget.",'component,auth,captcha,security'],
'frontend/src/components/chapter/ChapterEditor.tsx':["Lazy loader for the chapter editor implementation with a BookLoader fallback.",'component,editor,lazy-loading'],
'frontend/src/components/chapter/ChapterEditorImpl.tsx':["Actual chapter editor implementation using authenticated user context.",'component,editor,chapter'],
'frontend/src/components/common/BookLoader.tsx':["Animated book loader used as loading indicator.",'component,loading,ui'],
'frontend/src/components/common/NavTracker.tsx':["Starts navigation tracking for the back-navigation stack.",'component,navigation,tracking'],
'frontend/src/components/common/NavigationProgress.tsx':["Top-level navigation progress overlay shown during route changes.",'component,navigation,loading'],
'frontend/src/components/common/RateLimitNotice.tsx':["Notice banner shown when API rate limits are hit.",'component,rate-limit,notice'],
'frontend/src/components/common/ThemeToggle.tsx':["Button that toggles light/dark theme via useTheme.",'component,theme,ui'],
'frontend/src/components/notifications/NotificationItem.tsx':["Single notification row renderer.",'component,notifications,list'],
'frontend/src/components/random/StoryCaseOpening.tsx':["Case-opening style random story roulette with tiers and animated ticking.",'component,random,animation,gamification'],
'frontend/src/components/reader/ContinueReadingMiniplayer.tsx':["Floating miniplayer for continuing reading with compact and card views and preset sizes.",'component,reader,miniplayer,floating-ui'],
'frontend/src/components/reader/MiniplayerReaderView.tsx':["Reader content view shown within the miniplayer, loading chapter content and recording reading history.",'component,reader,miniplayer'],
'frontend/src/components/workspace/PullDialog.tsx':["Dialog to pull changes from another version with side-by-side display.",'component,workspace,dialog,diff'],
'frontend/src/components/workspace/ShareDialog.tsx':["Dialog for sharing a chapter draft.",'component,workspace,dialog,sharing'],
'frontend/src/context/ReadingSessionContext.tsx':["React context provider tracking the current reading session for the miniplayer.",'context,state,reading-session'],
'frontend/src/lib/chapterBlocks.ts':["Converts between chapter HTML, plain text and blocks and counts words.",'utility,chapter,html,conversion'],
'frontend/src/lib/chapterContent.ts':["Normalizes chapter content including markdown image detection.",'utility,chapter,normalization'],
'frontend/src/lib/chapterRender.ts':["Escapes and enhances chapter HTML and plain text, including footnote markers.",'utility,chapter,rendering'],
'frontend/src/lib/miniplayerPref.ts':["Hook storing whether the miniplayer is enabled.",'hook,preferences,miniplayer'],
'frontend/src/lib/nav.ts':["In-site navigation stack tracking powering BackLink, BackButton and goBack.",'utility,navigation,history'],
'frontend/src/lib/theme.ts':["useTheme hook managing light/dark theme state.",'hook,theme,preferences'],
'frontend/src/lib/themeScript.ts':["Inline script string applied before hydration to avoid theme flash.",'script,theme,constants'],
};
for(const b of g.batches){
const r=require('./ua-file-extract-results-'+b.batchIndex+'.json');const nodes=[],edges=[];
for(const f of r.results){const p=f.path;const [sum,tg]=S[p];const tags=tg.split(',');
const nl=f.nonEmptyLines;const cx=nl>200?'complex':nl>=50?'moderate':'simple';
const fid='file:'+p;nodes.push({id:fid,type:'file',name:p.split('/').pop(),filePath:p,summary:sum,tags,complexity:cx});
const exp=new Set((f.exports||[]).map(e=>e.name));
for(const fn of f.functions||[]){if(!(fn.endLine-fn.startLine>=9||exp.has(fn.name)))continue;
const id=`function:${p}:${fn.name}`;if(nodes.some(n=>n.id===id))continue;const len=fn.endLine-fn.startLine;
nodes.push({id,type:'function',name:fn.name,filePath:p,lineRange:[fn.startLine,fn.endLine],summary:`${fn.name} in ${p.split('/').pop()}: part of ${sum.charAt(0).toLowerCase()+sum.slice(1)}`,tags:tags.slice(0,3).concat(['function']),complexity:len>150?'complex':len>=30?'moderate':'simple'});
edges.push({source:fid,target:id,type:'contains',direction:'forward',weight:1.0});}
for(const c of f.classes||[]){const id=`class:${p}:${c.name}`;nodes.push({id,type:'class',name:c.name,filePath:p,lineRange:[c.startLine,c.endLine],summary:`${c.name} class in ${p.split('/').pop()}`,tags:tags.slice(0,3).concat(['class']),complexity:'simple'});edges.push({source:fid,target:id,type:'contains',direction:'forward',weight:1.0});}
for(const t of b.batchImportData[p]||[])edges.push({source:fid,target:'file:'+t,type:'imports',direction:'forward',weight:0.7});
if(p.endsWith('.test.ts'))edges.push({source:'file:frontend/src/lib/coalesce.ts',target:fid,type:'tested_by',direction:'forward',weight:0.5});}
fs.writeFileSync(`../intermediate/batch-${b.batchIndex}.json`,JSON.stringify({nodes,edges}));
console.log(b.batchIndex,nodes.length,edges.length)}

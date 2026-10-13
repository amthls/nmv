const fs=require('fs');
const M={
'frontend/src/app/album/[id]/page.tsx':['Next.js page showing a single album with its stories, owner actions, sharing link and copy-to-my-albums flow.','page,album,react,client-component'],
'frontend/src/app/bao-cao/page.tsx':['Reports page listing content reports with search and navigation to the reported target.','page,moderation,reports,react'],
'frontend/src/app/bookmark/page.tsx':['Bookmark page where users manage followed stories and saved albums.','page,bookmark,albums,react'],
'frontend/src/app/da-go/page.tsx':['Page listing removed content with search and restore actions for moderators.','page,moderation,restore,react'],
'frontend/src/app/dat-lai-mat-khau/page.tsx':['Password reset page that consumes a reset token and submits a new password via the account card UI.','page,auth,password-reset,react'],
'frontend/src/app/fandom/[slug]/page.tsx':['Fandom post detail page with rich content, gallery, reactions, comments, reporting and editing.','page,fandom,post-detail,react'],
'frontend/src/app/fandom/page.tsx':['Fandom feed page with category filters, search, post cards and post creation modal.','page,fandom,feed,react'],
'frontend/src/app/lich-su/page.tsx':['Reading history page showing recent chapters read by user or guest, with removal controls.','page,reading-history,react,client-component'],
'frontend/src/app/ma/[code]/page.tsx':['Short-code resolver page that looks up an entity code and redirects to the matching page.','page,routing,redirect,react'],
'frontend/src/app/nguoi-dung/[username]/page.tsx':['Public user profile page with stats, role badges and owner/admin management actions.','page,profile,user,react'],
'frontend/src/app/nhom-dich/page.tsx':['Translation groups listing page with search and a create-group modal.','page,groups,search,react'],
'frontend/src/app/tai-khoan/page.tsx':['Large account dashboard page with profile editing, stats, reading preferences, security, albums and admin panels.','page,account,dashboard,react'],
'frontend/src/app/thong-bao/page.tsx':['Notifications page with search, filters and realtime updates.','page,notifications,realtime,react'],
'frontend/src/app/truyen/[slug]/[chapterSlug]/page.tsx':['Chapter reader page supporting novel text and manga modes, reader settings, navigation, download, comments and reading-history logging.','page,reader,chapter,react'],
'frontend/src/app/truyen/[slug]/page.tsx':['Story detail page with metadata, chapter list, follow/album actions, uploads, recommendations and comments.','page,story-detail,react,client-component'],
'frontend/src/components/SearchBox.tsx':['Debounced global story search box with a dropdown of image-rich suggestions.','component,search,autocomplete,react'],
'frontend/src/components/account/ConfirmPassword.tsx':['Hook providing a password confirmation prompt for sensitive account actions.','hook,account,security,react'],
'frontend/src/components/account/SecurityTab.tsx':['Account security tab for password change and session management.','component,account,security,react'],
'frontend/src/components/admin/RecommenderPanel.tsx':['Admin panel showing recommender system metrics in tables.','component,admin,recommender,react'],
'frontend/src/components/album/AlbumCard.tsx':['Card component displaying an album cover, title and counts.','component,album,card,react'],
'frontend/src/components/album/CopyAlbumModal.tsx':['Modal for copying a shared album into the current user library.','component,album,modal,react'],
'frontend/src/components/album/SaveToAlbumModal.tsx':['Modal for saving a story into one or more of the user albums.','component,album,modal,react'],
'frontend/src/components/album/StoryAlbumsSection.tsx':['Section on a story page listing public albums that contain the story.','component,album,story,react'],
'frontend/src/components/auth/AccountCard.tsx':['Shared auth form primitives: card layout, notices, password input, auth POST helper and link-token hook.','component,auth,forms,react'],
'frontend/src/components/comments/CommentSection.tsx':['Threaded comment section with posting, replying, deleting and reporting.','component,comments,react,interaction'],
'frontend/src/components/common/CodeBadge.tsx':['Badge rendering short entity codes with explanatory tooltip text.','component,badge,ui,react'],
'frontend/src/components/common/ImageQualityPicker.tsx':['Selector control for choosing image quality level.','component,image-quality,settings,react'],
'frontend/src/components/common/ImageUploadDropzone.tsx':['Drag-and-drop image upload control with preview and authenticated upload.','component,upload,image,react'],
'frontend/src/components/common/ReportButton.tsx':['Button and modal for reporting content with reason selection.','component,moderation,report,react'],
'frontend/src/components/common/RichContent.tsx':['Renders sanitized rich HTML or plain text content with quality-adjusted images.','component,rich-text,rendering,react'],
'frontend/src/components/common/RichTextEditor.tsx':['Lazy-loading wrapper that dynamically imports the rich text editor with a loader fallback.','component,editor,dynamic-import,react'],
'frontend/src/components/common/RichTextEditorImpl.tsx':['Rich text editor implementation with toolbar and image upload.','component,editor,rich-text,react'],
'frontend/src/components/common/SearchInput.tsx':['Simple styled search input with clear control.','component,input,search,react'],
'frontend/src/components/common/SmartImage.tsx':['Image component that applies quality-based URL rewriting and fallback handling.','component,image,ui,react'],
'frontend/src/components/fandom/CreatePostModal.tsx':['Modal for creating or editing fandom posts with category, linked story, rich text and images.','component,fandom,modal,react'],
'frontend/src/components/fandom/PostCard.tsx':['Fandom post feed card with author, excerpt, gallery and reactions.','component,fandom,card,react'],
'frontend/src/components/fandom/ReactionBar.tsx':['Reaction buttons bar for fandom posts with optimistic toggling.','component,fandom,reactions,react'],
'frontend/src/components/fandom/SmartPostGallery.tsx':['Adaptive image gallery layout for post images.','component,fandom,gallery,react'],
'frontend/src/components/fandom/SmartStorySearch.tsx':['Story picker with search used to link a story to a post.','component,fandom,search,react'],
'frontend/src/components/groups/CreateGroupModal.tsx':['Modal for creating a translation group with avatar and rich description.','component,groups,modal,react'],
'frontend/src/components/reader/FloatingReaderBar.tsx':['Floating toolbar for the chapter reader with navigation and settings controls.','component,reader,toolbar,react'],
'frontend/src/components/reader/ImageLightbox.tsx':['Fullscreen lightbox overlay for viewing images.','component,reader,lightbox,react'],
'frontend/src/components/reader/MangaReader.tsx':['Manga reader supporting single, double-page and long-strip modes with persisted settings.','component,reader,manga,react'],
'frontend/src/components/reader/ReaderSettingsModal.tsx':['Settings modal and persistence helpers for reader fonts, sizes, themes and image quality.','component,reader,settings,react'],
'frontend/src/components/story/DownloadModal.tsx':['Modal for selecting chapters and formats to download from a story.','component,download,modal,react'],
'frontend/src/components/story/StoryForm.tsx':['Large form for creating and editing stories including metadata, cover, tags and chapter upload.','component,story,form,react'],
'frontend/src/context/AuthContext.tsx':['React auth context provider managing session, cached user, realtime connection and guest history merge.','context,auth,provider,react'],
'frontend/src/lib/albums.ts':['Album helpers for building paths, share URLs, clipboard copy and JSON parsing.','utility,album,helpers,api'],
'frontend/src/lib/apiJson.ts':['Fetch helper returning parsed JSON plus exported base URLs of backend services.','utility,api-client,config,fetch'],
'frontend/src/lib/fandom.ts':['Fandom constants (categories, reactions, role badges) and time/JSON helpers.','utility,fandom,constants,helpers'],
'frontend/src/lib/imageQuality.ts':['Image quality options, URL rewriting for width variants, HTML image rewriting and a preference hook.','utility,image-quality,hook,rewriting'],
'frontend/src/lib/readingHistory.ts':['Reading history logic for guests (localStorage) and users, reading position saving and guest-to-account merge.','utility,reading-history,storage,api'],
'frontend/src/lib/richText.ts':['Helpers to detect HTML content, strip tags and check for rich content.','utility,rich-text,html,helpers'],
'frontend/src/lib/session.ts':['Session helpers: CSRF token reading, session refresh and authenticated fetch wrapper.','utility,session,csrf,auth'],
'frontend/src/lib/useDebounced.ts':['Hook returning a debounced value.','hook,debounce,utility,react']};
const FS={AlbumPage:'Default export wrapping the inner page in Suspense.',ResetPasswordPage:'Default export wrapping the form in Suspense.',FandomPage:'Default export wrapping content in Suspense.',MangaReader:'Main manga reader component handling page modes and navigation.',AuthProvider:'Provides auth state, login/logout and session refresh to the app.',useAuth:'Hook returning the auth context.',apiJson:'Fetches a URL and returns parsed JSON, throwing on errors.',useDebounced:'Returns a value delayed by the given milliseconds.',DownloadModal:'Modal component for download selection.',SearchBox:'Search box component.'};
function cx(n){return n>200?'complex':n>=50?'moderate':'simple'}
for(const bi of [3,4]){
 const r=require('./ua-file-extract-results-'+bi+'.json'),inp=require('./ua-file-analyzer-input-'+bi+'.json');
 const nodes=[],edges=[];
 for(const f of r.results){
  const m=M[f.path];if(!m)throw f.path;
  const fid='file:'+f.path;
  nodes.push({id:fid,type:'file',name:f.path.split('/').pop(),filePath:f.path,summary:m[0],tags:m[1].split(','),complexity:cx(f.nonEmptyLines)});
  for(const p of inp.batchImportData[f.path]||[])edges.push({source:fid,target:'file:'+p,type:'imports',direction:'forward',weight:0.7});
  const ex=new Set((f.exports||[]).map(e=>e.name));
  for(const fn of f.functions||[]){
   const len=fn.endLine-fn.startLine+1;
   if(len<10&&!ex.has(fn.name))continue;
   const id=`function:${f.path}:${fn.name}`;
   const comp=/^[A-Z]/.test(fn.name);
   const base=f.path.split('/').pop();
   nodes.push({id,type:'function',name:fn.name,filePath:f.path,lineRange:[fn.startLine,fn.endLine],summary:FS[fn.name]||(comp?`${fn.name} React component in ${base}.`:`${fn.name} helper in ${base}.`),tags:comp?['component','react','ui']:['helper','utility','function'],complexity:len>150?'complex':len>40?'moderate':'simple'});
   edges.push({source:fid,target:id,type:'contains',direction:'forward',weight:1.0});
   if(ex.has(fn.name))edges.push({source:fid,target:id,type:'exports',direction:'forward',weight:0.8});
  }
 }
 const exp=inp.batchFiles.reduce((s,f)=>s+(inp.batchImportData[f.path]||[]).length,0);
 console.log(bi,nodes.length,edges.length,'imports expected',exp,edges.filter(e=>e.type=='imports').length);
 fs.mkdirSync('../intermediate',{recursive:true});
 if(nodes.length>60||edges.length>120){
  const files=r.results.map(f=>f.path).sort();const parts=Math.ceil(Math.max(nodes.length/60,edges.length/120));const sz=Math.ceil(files.length/parts);
  for(let k=0;k<parts;k++){const fs_=new Set(files.slice(k*sz,(k+1)*sz));
   const pn=nodes.filter(n=>fs_.has(n.filePath));const ids=new Set(pn.map(n=>n.id));
   const pe=edges.filter(e=>ids.has(e.source));
   fs.writeFileSync(`../intermediate/batch-${bi}-part-${k+1}.json`,JSON.stringify({nodes:pn,edges:pe}));console.log('part',k+1,pn.length,pe.length);}
 } else fs.writeFileSync(`../intermediate/batch-${bi}.json`,JSON.stringify({nodes,edges}));
}

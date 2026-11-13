import Fastify,{type FastifyReply,type FastifyRequest} from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import {PrismaClient,Prisma,Role,PublishStatus,JournalPermission} from '@prisma/client';
import argon2 from 'argon2';
import {createWriteStream} from 'node:fs';
import {mkdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {z,ZodError} from 'zod';
import {config} from './config.js';
import {cleanRichText,publicUser} from './security.js';

type AuthUser={id:string;name:string;username:string;role:Role;active:boolean;mustChangePassword:boolean};
type SearchableBook={title:string;volumeNumber:number};
type SearchableSeries<T extends SearchableBook>={title:string;books:T[]};
const seriesInput=z.object({title:z.string().trim().min(1).max(160),description:z.string().trim().default(''),genre:z.string().trim().max(120).default(''),status:z.nativeEnum(PublishStatus).default('DRAFT'),sortOrder:z.number().int().min(0).default(0)});
const bookInput=z.object({seriesId:z.string().uuid(),title:z.string().trim().min(1).max(160),subtitle:z.string().trim().max(200).nullable().optional(),description:z.string().trim().default(''),volumeNumber:z.number().int().positive().optional(),sortOrder:z.number().int().min(0).default(0),status:z.nativeEnum(PublishStatus).default('DRAFT')});
const chapterInput=z.object({bookId:z.string().uuid(),title:z.string().trim().min(1).max(200),content:z.string(),sortOrder:z.number().int().min(0)});
const userInput=z.object({name:z.string().trim().min(1).max(120),username:z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9._-]+$/).transform(x=>x.toLowerCase()),password:z.string().min(8).max(128),role:z.nativeEnum(Role).default('READER'),active:z.boolean().default(true)});
const passwordInput=z.object({currentPassword:z.string().min(1),newPassword:z.string().min(8).max(128),confirmation:z.string().min(1)}).superRefine((data,ctx)=>{if(data.newPassword!==data.confirmation)ctx.addIssue({code:'custom',path:['confirmation'],message:'Die neuen Passwörter stimmen nicht überein.'});if(data.currentPassword===data.newPassword)ctx.addIssue({code:'custom',path:['newPassword'],message:'Das neue Passwort muss sich vom bisherigen Passwort unterscheiden.'})});
const journalInput=z.object({title:z.string().trim().min(1).max(160),description:z.string().trim().max(10000).default('')});
const entryInput=z.object({title:z.string().trim().max(200).nullable().optional(),content:z.string(),entryDate:z.coerce.date(),published:z.boolean().optional()});
const permissionInput=z.object({userId:z.string().uuid(),permission:z.nativeEnum(JournalPermission)});
const commentInput=z.object({content:z.string().trim().min(1).max(5000)});

function romanToNumber(value:string){
  const digits:{[key:string]:number}={I:1,V:5,X:10,L:50,C:100,D:500,M:1000};
  let result=0;
  for(let i=0;i<value.length;i++)result+=(digits[value[i]]??0)<(digits[value[i+1]]??0)?-(digits[value[i]]??0):(digits[value[i]]??0);
  return result;
}
function searchedVolume(query:string){
  const match=query.match(/^(?:band\s*)?(\d+|[ivxlcdm]+)$/i);
  if(!match)return;
  return /^\d+$/.test(match[1])?Number(match[1]):romanToNumber(match[1].toUpperCase());
}
export function filterLibrary<T extends SearchableBook,S extends SearchableSeries<T>>(items:S[],rawQuery?:string){
  const query=rawQuery?.trim().toLocaleLowerCase('de');
  if(!query)return items;
  const volume=searchedVolume(query);
  return items.flatMap(series=>{
    const books=series.title.toLocaleLowerCase('de').includes(query)
      ? series.books
      : series.books.filter(book=>book.title.toLocaleLowerCase('de').includes(query)||book.volumeNumber===volume);
    return books.length?[{...series,books}]:[];
  });
}
export function resolveJournalPermission(owner:boolean,journalPermission?:string,entryPermission?:string){
  if(owner)return 'OWNER';
  return entryPermission??journalPermission??'NONE';
}

export function buildApp(prisma=new PrismaClient()){
  const cfg=config();const app=Fastify({logger:cfg.NODE_ENV!=='test'});
  app.register(cookie,{secret:cfg.COOKIE_SECRET});app.register(cors,{origin:cfg.CORS_ORIGIN,credentials:true});
  app.register(multipart,{limits:{fileSize:cfg.MAX_UPLOAD_BYTES,files:1}});app.register(staticPlugin,{root:cfg.UPLOAD_DIR,prefix:'/uploads/',decorateReply:false});
  const fail=(reply:FastifyReply,status:number,code:string,message:string,fields?:Record<string,string[]>)=>reply.status(status).send({error:{code,message,...(fields&&{fields})}});
  async function auth(req:FastifyRequest,reply:FastifyReply,admin=false,allowPasswordChange=false):Promise<AuthUser|undefined>{
    const raw=req.cookies.dkl_session;if(!raw){fail(reply,401,'UNAUTHENTICATED','Bitte zuerst anmelden.');return}
    const parsed=req.unsignCookie(raw);if(!parsed.valid){fail(reply,401,'INVALID_SESSION','Die Sitzung ist ungültig.');return}
    const session=await prisma.session.findUnique({where:{id:parsed.value},include:{user:true}});
    if(!session||session.expiresAt<new Date()||!session.user.active){if(session)await prisma.session.delete({where:{id:session.id}});fail(reply,401,'SESSION_EXPIRED','Die Sitzung ist abgelaufen.');return}
    if(session.user.mustChangePassword&&!allowPasswordChange){fail(reply,403,'PASSWORD_CHANGE_REQUIRED','Bitte ändere zuerst dein vorläufiges Passwort.');return}
    if(admin&&session.user.role!=='ADMIN'){fail(reply,403,'FORBIDDEN','Administratorrechte erforderlich.');return}
    return publicUser(session.user);
  }
  const params=(req:FastifyRequest)=>z.object({id:z.string().uuid()}).parse(req.params).id;
  const coverUrl=(book:{coverPath:string|null})=>book.coverPath?`/uploads/${path.basename(book.coverPath)}`:null;
  const mapBook=<T extends {coverPath:string|null}>(b:T)=>({...b,coverUrl:coverUrl(b),coverPath:undefined,coverMimeType:undefined,coverOriginalName:undefined});
  const mapSeries=<T extends {coverPath:string|null}>(s:T)=>({...s,coverUrl:coverUrl(s),coverPath:undefined,coverMimeType:undefined,coverOriginalName:undefined});
  const permissionRank:Record<string,number>={NONE:0,READ:1,COMMENT:2,WRITE:3,OWNER:4};
  const hasPermission=(permission:string,needed:'READ'|'COMMENT'|'WRITE')=>permissionRank[permission]>=permissionRank[needed];
  async function journalPermission(journalId:string,userId:string){
    const journal=await prisma.journal.findUnique({where:{id:journalId},include:{shares:{where:{userId}}}});
    if(!journal)return;
    if(journal.ownerId===userId)return {journal,permission:'OWNER' as const};
    return {journal,permission:journal.shares[0]?.permission??'NONE'};
  }
  async function entryPermission(entryId:string,userId:string){
    const entry=await prisma.journalEntry.findUnique({where:{id:entryId},include:{journal:{include:{shares:{where:{userId}}}},shares:{where:{userId}}}});
    if(!entry)return;
    const permission=resolveJournalPermission(entry.journal.ownerId===userId,entry.journal.shares[0]?.permission,entry.shares[0]?.permission);
    return {entry,permission};
  }
  const mapShares=(shares:Array<{userId:string;permission:JournalPermission;user:{username:string;name:string}}>)=>shares.map(s=>({userId:s.userId,username:s.user.username,name:s.user.name,permission:s.permission}));
  const mapComments=(comments:Array<{id:string;entryId:string;authorId:string;content:string;createdAt:Date;updatedAt:Date;author:{name:string}}>,actor:AuthUser,ownerId:string)=>comments.map(c=>({...c,authorName:c.author.name,canEdit:c.authorId===actor.id,canDelete:c.authorId===actor.id||ownerId===actor.id,author:undefined}));
  const validShareTarget=async(userId:string)=>!!await prisma.user.findFirst({where:{id:userId,active:true},select:{id:true}});

  app.setErrorHandler((err,_,reply)=>{
    if(err instanceof ZodError)return fail(reply,400,'VALIDATION_ERROR','Eingaben sind ungültig.',z.flattenError(err).fieldErrors as Record<string,string[]>);
    if(err instanceof Prisma.PrismaClientKnownRequestError){
      if(err.code==='P2002')return fail(reply,409,'CONFLICT','Dieser Wert oder diese Reihenfolge wird bereits verwendet.');
      if(err.code==='P2025')return fail(reply,404,'NOT_FOUND','Eintrag nicht gefunden.');
    }
    const httpError=err as {statusCode?:unknown;message?:unknown};
    if(typeof httpError.statusCode==='number'&&httpError.statusCode<500)return fail(reply,httpError.statusCode,'BAD_REQUEST',typeof httpError.message==='string'?httpError.message:'Ungültige Anfrage.');
    app.log.error(err);
    return fail(reply,500,'INTERNAL_ERROR','Ein unerwarteter Fehler ist aufgetreten.');
  });
  app.get('/api/health',async()=>({status:'ok'}));
  app.post('/api/auth/login',async(req,reply)=>{const body=z.object({username:z.string().min(1),password:z.string().min(1)}).parse(req.body);const user=await prisma.user.findUnique({where:{username:body.username.toLowerCase()}});if(!user||!user.active||!await argon2.verify(user.passwordHash,body.password))return fail(reply,401,'INVALID_CREDENTIALS','Benutzername oder Passwort ist falsch.');const session=await prisma.session.create({data:{userId:user.id,expiresAt:new Date(Date.now()+30*864e5)}});reply.setCookie('dkl_session',session.id,{path:'/',httpOnly:true,sameSite:'lax',secure:cfg.COOKIE_SECURE,signed:true,maxAge:30*86400});return {user:publicUser(user)}});
  app.post('/api/auth/logout',async(req,reply)=>{const raw=req.cookies.dkl_session;reply.clearCookie('dkl_session',{path:'/',httpOnly:true,sameSite:'lax',secure:cfg.COOKIE_SECURE});if(raw){const p=req.unsignCookie(raw);if(p.valid)await prisma.session.deleteMany({where:{id:p.value}}).catch(err=>app.log.error(err))}return {ok:true}});
  app.get('/api/auth/me',async(req,reply)=>{const user=await auth(req,reply,false,true);if(!user)return;return {user}});
  app.post('/api/auth/change-password',async(req,reply)=>{const user=await auth(req,reply,false,true);if(!user)return;const data=passwordInput.parse(req.body);const stored=await prisma.user.findUniqueOrThrow({where:{id:user.id},select:{passwordHash:true}});if(!await argon2.verify(stored.passwordHash,data.currentPassword))return fail(reply,400,'INVALID_CURRENT_PASSWORD','Das aktuelle Passwort ist falsch.');await prisma.user.update({where:{id:user.id},data:{passwordHash:await argon2.hash(data.newPassword),mustChangePassword:false}});const raw=req.cookies.dkl_session;const currentSession=raw?req.unsignCookie(raw):undefined;await prisma.session.deleteMany({where:{userId:user.id,...(currentSession?.valid?{id:{not:currentSession.value}}:{})}});const updated=await prisma.user.findUniqueOrThrow({where:{id:user.id}});return {user:publicUser(updated)}});

  app.get('/api/library',async(req)=>{const q=z.object({q:z.string().optional()}).parse(req.query).q?.trim().toLocaleLowerCase('de');const items=await prisma.series.findMany({where:{status:'PUBLISHED'},include:{books:{where:{status:'PUBLISHED'},select:{title:true}}},orderBy:[{sortOrder:'asc'},{title:'asc'}]});const journals=await prisma.journal.findMany({where:{entries:{some:{published:true}}},include:{owner:{select:{name:true}},entries:{where:{published:true},select:{id:true,title:true}}},orderBy:{updatedAt:'desc'}});return {series:items.filter(s=>!q||s.title.toLocaleLowerCase('de').includes(q)||s.books.some(b=>b.title.toLocaleLowerCase('de').includes(q))).map(s=>({id:s.id,title:s.title,description:s.description,genre:s.genre,bookCount:s.books.length,coverUrl:coverUrl(s),kind:'series'})),journals:journals.filter(j=>!q||j.title.toLocaleLowerCase('de').includes(q)||j.entries.some(e=>e.title?.toLocaleLowerCase('de').includes(q))).map(j=>({id:j.id,title:j.title,description:j.description,ownerName:j.owner.name,entryCount:j.entries.length,kind:'journal'}))}});
  app.get('/api/library/series/:id',async(req,reply)=>{const series=await prisma.series.findFirst({where:{id:params(req),status:'PUBLISHED'},include:{books:{where:{status:'PUBLISHED'},orderBy:[{sortOrder:'asc'},{volumeNumber:'asc'}],include:{chapters:{orderBy:{sortOrder:'asc'}}}}}});if(!series)return fail(reply,404,'NOT_FOUND','Buchreihe nicht gefunden.');return {series:mapSeries({...series,books:series.books.map(mapBook)})}});
  app.get('/api/library/journals/:id',async(req,reply)=>{const journal=await prisma.journal.findFirst({where:{id:params(req),entries:{some:{published:true}}},include:{owner:{select:{name:true}},entries:{where:{published:true},orderBy:{entryDate:'desc'},select:{id:true,title:true,content:true,entryDate:true,createdAt:true,updatedAt:true}}}});if(!journal)return fail(reply,404,'NOT_FOUND','Tagebuch nicht gefunden.');return {journal:{id:journal.id,title:journal.title,description:journal.description,ownerName:journal.owner.name,entries:journal.entries}}});
  app.get('/api/library/books/:id',async(req,reply)=>{const id=params(req);const book=await prisma.book.findFirst({where:{id,status:'PUBLISHED',series:{status:'PUBLISHED'}},include:{series:true,chapters:{orderBy:{sortOrder:'asc'}}}});if(!book)return fail(reply,404,'NOT_FOUND','Buch nicht gefunden.');return {book:mapBook(book)}});

  app.get('/api/me/bookmarks',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const rows=await prisma.bookmark.findMany({where:{userId:user.id},include:{book:true},orderBy:{createdAt:'desc'}});return {books:rows.map(r=>mapBook(r.book))}});
  app.put('/api/me/bookmarks/:id',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const bookId=params(req);const book=await prisma.book.findFirst({where:{id:bookId,status:'PUBLISHED',series:{status:'PUBLISHED'}}});if(!book)return fail(reply,404,'NOT_FOUND','Buch nicht gefunden.');await prisma.bookmark.upsert({where:{userId_bookId:{userId:user.id,bookId}},create:{userId:user.id,bookId},update:{}});return {bookmarked:true}});
  app.delete('/api/me/bookmarks/:id',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;await prisma.bookmark.deleteMany({where:{userId:user.id,bookId:params(req)}});return {bookmarked:false}});
  app.get('/api/me/progress',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;return {progress:await prisma.readingProgress.findMany({where:{userId:user.id},include:{book:true,chapter:true},orderBy:{updatedAt:'desc'}})}});
  app.put('/api/me/progress/:id',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const bookId=params(req);const {chapterId}=z.object({chapterId:z.string().uuid()}).parse(req.body);const chapter=await prisma.chapter.findFirst({where:{id:chapterId,bookId,book:{status:'PUBLISHED',series:{status:'PUBLISHED'}}}});if(!chapter)return fail(reply,404,'NOT_FOUND','Kapitel nicht gefunden.');const progress=await prisma.readingProgress.upsert({where:{userId_bookId:{userId:user.id,bookId}},create:{userId:user.id,bookId,chapterId},update:{chapterId}});return {progress}});

  app.get('/api/users/search',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const q=z.object({q:z.string().trim().min(2).max(80)}).parse(req.query).q.toLowerCase();return {users:await prisma.user.findMany({where:{active:true,id:{not:user.id},username:{contains:q}},select:{id:true,username:true,name:true},take:10,orderBy:{username:'asc'}})}});
  app.get('/api/me/journals',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const rows=await prisma.journal.findMany({where:{OR:[{ownerId:user.id},{shares:{some:{userId:user.id,permission:{not:'NONE'}}}},{entries:{some:{shares:{some:{userId:user.id,permission:{not:'NONE'}}}}}}]},include:{owner:{select:{name:true}},shares:{where:{userId:user.id}},entries:{include:{shares:{where:{userId:user.id}}},orderBy:{entryDate:'desc'}}},orderBy:{updatedAt:'desc'}});return {journals:rows.map(j=>{const own=j.ownerId===user.id;const base=own?'OWNER':j.shares[0]?.permission??'NONE';return {id:j.id,ownerId:j.ownerId,ownerName:j.owner.name,title:j.title,description:j.description,createdAt:j.createdAt,updatedAt:j.updatedAt,permission:base,entries:j.entries.filter(e=>own||hasPermission(e.shares[0]?.permission??base,'READ')).map(e=>({...e,content:'',permission:own?'OWNER':e.shares[0]?.permission??base,shares:undefined}))}})}});
  app.post('/api/me/journals',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;return {journal:await prisma.journal.create({data:{...journalInput.parse(req.body),ownerId:user.id}})}});
  app.get('/api/me/journals/:id',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const access=await journalPermission(params(req),user.id);if(!access)return fail(reply,404,'NOT_FOUND','Tagebuch nicht gefunden.');const entryOnly=!hasPermission(access.permission,'READ')&&await prisma.journalEntryShare.count({where:{userId:user.id,permission:{not:'NONE'},entry:{journalId:access.journal.id}}})>0;if(!hasPermission(access.permission,'READ')&&!entryOnly)return fail(reply,404,'NOT_FOUND','Tagebuch nicht gefunden.');const own=access.permission==='OWNER';const journal=await prisma.journal.findUniqueOrThrow({where:{id:access.journal.id},include:{owner:{select:{name:true}},shares:{include:{user:{select:{username:true,name:true}}}},entries:{include:{shares:{where:own?undefined:{userId:user.id}}},orderBy:{entryDate:'desc'}}}});return {journal:{...journal,ownerName:journal.owner.name,owner:undefined,permission:access.permission,shares:own?mapShares(journal.shares):undefined,entries:journal.entries.filter(e=>own||hasPermission(e.shares[0]?.permission??access.permission,'READ')).map(e=>({...e,content:'',permission:own?'OWNER':e.shares[0]?.permission??access.permission,shares:undefined}))}}});
  app.put('/api/me/journals/:id',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const id=params(req);const access=await journalPermission(id,user.id);if(access?.permission!=='OWNER')return fail(reply,403,'FORBIDDEN','Nur der Besitzer darf das Tagebuch bearbeiten.');return {journal:await prisma.journal.update({where:{id},data:journalInput.partial().parse(req.body)})}});
  app.delete('/api/me/journals/:id',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const id=params(req);const access=await journalPermission(id,user.id);if(access?.permission!=='OWNER')return fail(reply,403,'FORBIDDEN','Nur der Besitzer darf das Tagebuch löschen.');await prisma.journal.delete({where:{id}});return {ok:true}});
  app.put('/api/me/journals/:id/shares',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const id=params(req);const access=await journalPermission(id,user.id);if(access?.permission!=='OWNER')return fail(reply,403,'FORBIDDEN','Nur der Besitzer darf Freigaben ändern.');const data=permissionInput.parse(req.body);if(data.userId===user.id)return fail(reply,400,'INVALID_SHARE','Das eigene Tagebuch muss nicht geteilt werden.');if(!await validShareTarget(data.userId))return fail(reply,404,'USER_NOT_FOUND','Aktiver Nutzer nicht gefunden.');await prisma.journalShare.upsert({where:{journalId_userId:{journalId:id,userId:data.userId}},create:{journalId:id,...data},update:{permission:data.permission}});return {ok:true}});
  app.delete('/api/me/journals/:id/shares/:userId',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const p=z.object({id:z.string().uuid(),userId:z.string().uuid()}).parse(req.params);const access=await journalPermission(p.id,user.id);if(access?.permission!=='OWNER')return fail(reply,403,'FORBIDDEN','Nur der Besitzer darf Freigaben ändern.');await prisma.journalShare.deleteMany({where:{journalId:p.id,userId:p.userId}});return {ok:true}});
  app.post('/api/me/journals/:id/entries',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const journalId=params(req);const access=await journalPermission(journalId,user.id);if(!access||!hasPermission(access.permission,'WRITE'))return fail(reply,403,'FORBIDDEN','Keine Schreibberechtigung.');const data=entryInput.parse(req.body);return {entry:await prisma.journalEntry.create({data:{journalId,title:data.title||null,content:cleanRichText(data.content),entryDate:data.entryDate,published:access.permission==='OWNER'?(data.published??false):false}})}});
  app.get('/api/me/journal-entries/:id',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const access=await entryPermission(params(req),user.id);if(!access||!hasPermission(access.permission,'READ'))return fail(reply,404,'NOT_FOUND','Eintrag nicht gefunden.');const own=access.permission==='OWNER';const entry=await prisma.journalEntry.findUniqueOrThrow({where:{id:access.entry.id},include:{journal:true,shares:{include:{user:{select:{username:true,name:true}}}},comments:{include:{author:{select:{name:true}}},orderBy:{createdAt:'asc'}}}});return {entry:{...entry,journal:undefined,permission:access.permission,shares:own?mapShares(entry.shares):undefined,comments:mapComments(entry.comments,user,entry.journal.ownerId)}}});
  app.put('/api/me/journal-entries/:id',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const id=params(req);const access=await entryPermission(id,user.id);if(!access||!hasPermission(access.permission,'WRITE'))return fail(reply,403,'FORBIDDEN','Keine Schreibberechtigung.');const data=entryInput.partial().parse(req.body);if(access.permission!=='OWNER'&&data.published!==undefined)return fail(reply,403,'FORBIDDEN','Nur der Besitzer darf Einträge veröffentlichen.');return {entry:await prisma.journalEntry.update({where:{id},data:{...data,...(data.content!==undefined&&{content:cleanRichText(data.content)})}})}});
  app.delete('/api/me/journal-entries/:id',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const id=params(req);const access=await entryPermission(id,user.id);if(access?.permission!=='OWNER')return fail(reply,403,'FORBIDDEN','Nur der Besitzer darf Einträge löschen.');await prisma.journalEntry.delete({where:{id}});return {ok:true}});
  app.put('/api/me/journal-entries/:id/shares',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const entryId=params(req);const access=await entryPermission(entryId,user.id);if(access?.permission!=='OWNER')return fail(reply,403,'FORBIDDEN','Nur der Besitzer darf Freigaben ändern.');const data=permissionInput.parse(req.body);if(data.userId===user.id)return fail(reply,400,'INVALID_SHARE','Der Besitzer benötigt keine Freigabe.');if(!await validShareTarget(data.userId))return fail(reply,404,'USER_NOT_FOUND','Aktiver Nutzer nicht gefunden.');await prisma.journalEntryShare.upsert({where:{entryId_userId:{entryId,userId:data.userId}},create:{entryId,...data},update:{permission:data.permission}});return {ok:true}});
  app.delete('/api/me/journal-entries/:id/shares/:userId',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const p=z.object({id:z.string().uuid(),userId:z.string().uuid()}).parse(req.params);const access=await entryPermission(p.id,user.id);if(access?.permission!=='OWNER')return fail(reply,403,'FORBIDDEN','Nur der Besitzer darf Freigaben ändern.');await prisma.journalEntryShare.deleteMany({where:{entryId:p.id,userId:p.userId}});return {ok:true}});
  app.post('/api/me/journal-entries/:id/comments',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const entryId=params(req);const access=await entryPermission(entryId,user.id);if(!access||!hasPermission(access.permission,'COMMENT'))return fail(reply,403,'FORBIDDEN','Keine Kommentarberechtigung.');return {comment:await prisma.journalComment.create({data:{entryId,authorId:user.id,...commentInput.parse(req.body)}})}});
  app.put('/api/me/journal-comments/:id',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const id=params(req);const comment=await prisma.journalComment.findUnique({where:{id}});if(!comment||comment.authorId!==user.id)return fail(reply,403,'FORBIDDEN','Nur eigene Kommentare dürfen bearbeitet werden.');const access=await entryPermission(comment.entryId,user.id);if(!access||!hasPermission(access.permission,'COMMENT'))return fail(reply,403,'FORBIDDEN','Keine Kommentarberechtigung.');return {comment:await prisma.journalComment.update({where:{id},data:commentInput.parse(req.body)})}});
  app.delete('/api/me/journal-comments/:id',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const id=params(req);const comment=await prisma.journalComment.findUnique({where:{id},include:{entry:{include:{journal:true}}}});if(!comment||(comment.authorId!==user.id&&comment.entry.journal.ownerId!==user.id))return fail(reply,403,'FORBIDDEN','Kommentar darf nicht gelöscht werden.');await prisma.journalComment.delete({where:{id}});return {ok:true}});

  app.get('/api/admin/series',async(req,reply)=>{if(!await auth(req,reply,true))return;const rows=await prisma.series.findMany({include:{books:{include:{chapters:{orderBy:{sortOrder:'asc'}}},orderBy:[{sortOrder:'asc'},{volumeNumber:'asc'}]}},orderBy:[{sortOrder:'asc'},{title:'asc'}]});return {series:rows.map(s=>mapSeries({...s,books:s.books.map(mapBook)}))}});
  app.post('/api/admin/series',async(req,reply)=>{if(!await auth(req,reply,true))return;return {series:await prisma.series.create({data:seriesInput.parse(req.body)})}});
  app.put('/api/admin/series/:id',async(req,reply)=>{if(!await auth(req,reply,true))return;return {series:await prisma.series.update({where:{id:params(req)},data:seriesInput.partial().parse(req.body)})}});
  app.delete('/api/admin/series/:id',async(req,reply)=>{if(!await auth(req,reply,true))return;const series=await prisma.series.delete({where:{id:params(req)}});if(series.coverPath)await unlink(series.coverPath).catch(err=>app.log.warn({err,seriesId:series.id},'Could not delete series cover'));return {ok:true}});
  app.post('/api/admin/books',async(req,reply)=>{if(!await auth(req,reply,true))return;const data=bookInput.parse(req.body);const volumeNumber=data.volumeNumber??((await prisma.book.aggregate({where:{seriesId:data.seriesId},_max:{volumeNumber:true}}))._max.volumeNumber??0)+1;return {book:mapBook(await prisma.book.create({data:{...data,volumeNumber}}))}});
  app.put('/api/admin/books/:id',async(req,reply)=>{if(!await auth(req,reply,true))return;return {book:mapBook(await prisma.book.update({where:{id:params(req)},data:bookInput.partial().parse(req.body)}))}});
  app.delete('/api/admin/books/:id',async(req,reply)=>{
    if(!await auth(req,reply,true))return;
    const id=params(req);
    // Delete dependants explicitly. This also works against databases whose
    // foreign keys predate the cascade rules in the current Prisma schema.
    const book=await prisma.$transaction(async tx=>{
      const existing=await tx.book.findUniqueOrThrow({where:{id}});
      await tx.readingProgress.deleteMany({where:{bookId:id}});
      await tx.bookmark.deleteMany({where:{bookId:id}});
      await tx.chapter.deleteMany({where:{bookId:id}});
      await tx.book.delete({where:{id}});
      return existing;
    });
    if(book.coverPath)await unlink(book.coverPath).catch(err=>app.log.warn({err,bookId:id},'Could not delete book cover'));
    return {ok:true};
  });
  app.post('/api/admin/chapters',async(req,reply)=>{if(!await auth(req,reply,true))return;const data=chapterInput.parse(req.body);return {chapter:await prisma.chapter.create({data:{...data,content:cleanRichText(data.content)}})}});
  app.put('/api/admin/chapters/:id',async(req,reply)=>{if(!await auth(req,reply,true))return;const data=chapterInput.partial().parse(req.body);return {chapter:await prisma.chapter.update({where:{id:params(req)},data:{...data,...(data.content!==undefined&&{content:cleanRichText(data.content)})}})}});
  app.delete('/api/admin/chapters/:id',async(req,reply)=>{if(!await auth(req,reply,true))return;await prisma.chapter.delete({where:{id:params(req)}});return {ok:true}});
  app.post('/api/admin/books/:id/cover',async(req,reply)=>{if(!await auth(req,reply,true))return;const id=params(req);const file=await req.file();if(!file)return fail(reply,400,'FILE_REQUIRED','Bitte ein Bild auswählen.');const ext:{[k:string]:string}={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'};if(!ext[file.mimetype])return fail(reply,415,'INVALID_FILE_TYPE','Erlaubt sind JPG, PNG und WebP.');await mkdir(cfg.UPLOAD_DIR,{recursive:true});const filename=randomUUID()+ext[file.mimetype];const target=path.join(cfg.UPLOAD_DIR,filename);await pipeline(file.file,createWriteStream(target));const previous=await prisma.book.findUniqueOrThrow({where:{id}});const book=await prisma.book.update({where:{id},data:{coverPath:target,coverMimeType:file.mimetype,coverOriginalName:file.filename}});if(previous.coverPath&&previous.coverPath!==target)await unlink(previous.coverPath).catch(()=>{});return {book:mapBook(book)}});
  app.post('/api/admin/series/:id/cover',async(req,reply)=>{if(!await auth(req,reply,true))return;const id=params(req);const file=await req.file();if(!file)return fail(reply,400,'FILE_REQUIRED','Bitte ein Bild auswählen.');const ext:{[k:string]:string}={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'};if(!ext[file.mimetype])return fail(reply,415,'INVALID_FILE_TYPE','Erlaubt sind JPG, PNG und WebP.');await mkdir(cfg.UPLOAD_DIR,{recursive:true});const filename=randomUUID()+ext[file.mimetype];const target=path.join(cfg.UPLOAD_DIR,filename);await pipeline(file.file,createWriteStream(target));const previous=await prisma.series.findUniqueOrThrow({where:{id}});const series=await prisma.series.update({where:{id},data:{coverPath:target,coverMimeType:file.mimetype,coverOriginalName:file.filename}});if(previous.coverPath&&previous.coverPath!==target)await unlink(previous.coverPath).catch(()=>{});return {series:mapSeries(series)}});
  app.get('/api/admin/users',async(req,reply)=>{if(!await auth(req,reply,true))return;return {users:(await prisma.user.findMany({orderBy:{createdAt:'asc'}})).map(publicUser)}});
  app.post('/api/admin/users',async(req,reply)=>{if(!await auth(req,reply,true))return;const {password,...data}=userInput.parse(req.body);const user=await prisma.user.create({data:{...data,passwordHash:await argon2.hash(password),mustChangePassword:true}});return {user:publicUser(user)}});
  app.put('/api/admin/users/:id',async(req,reply)=>{const actor=await auth(req,reply,true);if(!actor)return;const id=params(req);const data=userInput.partial().parse(req.body);if(id===actor.id&&data.active===false)return fail(reply,400,'SELF_DEACTIVATION','Das eigene Konto kann nicht deaktiviert werden.');const {password,...rest}=data;const user=await prisma.user.update({where:{id},data:{...rest,...(password&&{passwordHash:await argon2.hash(password)})}});if(data.active===false)await prisma.session.deleteMany({where:{userId:id}});return {user:publicUser(user)}});
  app.delete('/api/admin/users/:id',async(req,reply)=>{const actor=await auth(req,reply,true);if(!actor)return;const id=params(req);if(id===actor.id)return fail(reply,400,'SELF_DELETE','Das eigene Konto kann nicht gelöscht werden.');await prisma.user.delete({where:{id}});return {ok:true}});
  app.addHook('onClose',()=>prisma.$disconnect());return app;
}

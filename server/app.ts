import Fastify,{type FastifyReply,type FastifyRequest} from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import {PrismaClient,Prisma,Role,PublishStatus} from '@prisma/client';
import argon2 from 'argon2';
import {createWriteStream} from 'node:fs';
import {mkdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {z,ZodError} from 'zod';
import {config} from './config.js';
import {cleanRichText,publicUser} from './security.js';

type AuthUser={id:string;name:string;username:string;role:Role;active:boolean};
const seriesInput=z.object({title:z.string().trim().min(1).max(160),description:z.string().trim().default(''),genre:z.string().trim().max(120).default(''),status:z.nativeEnum(PublishStatus).default('DRAFT'),sortOrder:z.number().int().min(0).default(0)});
const bookInput=z.object({seriesId:z.string().uuid(),title:z.string().trim().min(1).max(160),subtitle:z.string().trim().max(200).nullable().optional(),description:z.string().trim().default(''),volumeNumber:z.number().int().positive().optional(),sortOrder:z.number().int().min(0).default(0),status:z.nativeEnum(PublishStatus).default('DRAFT')});
const chapterInput=z.object({bookId:z.string().uuid(),title:z.string().trim().min(1).max(200),content:z.string(),sortOrder:z.number().int().min(0),status:z.nativeEnum(PublishStatus).default('DRAFT')});
const userInput=z.object({name:z.string().trim().min(1).max(120),username:z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9._-]+$/).transform(x=>x.toLowerCase()),password:z.string().min(10).max(128),role:z.nativeEnum(Role).default('READER'),active:z.boolean().default(true)});

export function buildApp(prisma=new PrismaClient()){
  const cfg=config();const app=Fastify({logger:cfg.NODE_ENV!=='test'});
  app.register(cookie,{secret:cfg.COOKIE_SECRET});app.register(cors,{origin:cfg.CORS_ORIGIN,credentials:true});
  app.register(multipart,{limits:{fileSize:cfg.MAX_UPLOAD_BYTES,files:1}});app.register(staticPlugin,{root:cfg.UPLOAD_DIR,prefix:'/uploads/',decorateReply:false});
  const fail=(reply:FastifyReply,status:number,code:string,message:string,fields?:Record<string,string[]>)=>reply.status(status).send({error:{code,message,...(fields&&{fields})}});
  async function auth(req:FastifyRequest,reply:FastifyReply,admin=false):Promise<AuthUser|undefined>{
    const raw=req.cookies.dkl_session;if(!raw){fail(reply,401,'UNAUTHENTICATED','Bitte zuerst anmelden.');return}
    const parsed=req.unsignCookie(raw);if(!parsed.valid){fail(reply,401,'INVALID_SESSION','Die Sitzung ist ungültig.');return}
    const session=await prisma.session.findUnique({where:{id:parsed.value},include:{user:true}});
    if(!session||session.expiresAt<new Date()||!session.user.active){if(session)await prisma.session.delete({where:{id:session.id}});fail(reply,401,'SESSION_EXPIRED','Die Sitzung ist abgelaufen.');return}
    if(admin&&session.user.role!=='ADMIN'){fail(reply,403,'FORBIDDEN','Administratorrechte erforderlich.');return}
    return publicUser(session.user);
  }
  const params=(req:FastifyRequest)=>z.object({id:z.string().uuid()}).parse(req.params).id;
  const coverUrl=(book:{coverPath:string|null})=>book.coverPath?`/uploads/${path.basename(book.coverPath)}`:null;
  const mapBook=<T extends {coverPath:string|null}>(b:T)=>({...b,coverUrl:coverUrl(b),coverPath:undefined,coverMimeType:undefined,coverOriginalName:undefined});

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
  app.get('/api/auth/me',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;return {user}});

  app.get('/api/library',async(req)=>{const q=z.object({q:z.string().optional()}).parse(req.query).q?.trim();const items=await prisma.series.findMany({where:{status:'PUBLISHED',...(q&&{OR:[{title:{contains:q}},{description:{contains:q}},{genre:{contains:q}},{books:{some:{title:{contains:q}}}}]})},include:{books:{where:{status:'PUBLISHED'},orderBy:[{sortOrder:'asc'},{volumeNumber:'asc'}],include:{chapters:{where:{status:'PUBLISHED'},orderBy:{sortOrder:'asc'}}}}},orderBy:[{sortOrder:'asc'},{title:'asc'}]});return {series:items.map(s=>({...s,books:s.books.map(mapBook)}))}});
  app.get('/api/library/books/:id',async(req,reply)=>{const id=params(req);const book=await prisma.book.findFirst({where:{id,status:'PUBLISHED',series:{status:'PUBLISHED'}},include:{series:true,chapters:{where:{status:'PUBLISHED'},orderBy:{sortOrder:'asc'}}}});if(!book)return fail(reply,404,'NOT_FOUND','Buch nicht gefunden.');return {book:mapBook(book)}});

  app.get('/api/me/bookmarks',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const rows=await prisma.bookmark.findMany({where:{userId:user.id},include:{book:true},orderBy:{createdAt:'desc'}});return {books:rows.map(r=>mapBook(r.book))}});
  app.put('/api/me/bookmarks/:id',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const bookId=params(req);const book=await prisma.book.findFirst({where:{id:bookId,status:'PUBLISHED',series:{status:'PUBLISHED'}}});if(!book)return fail(reply,404,'NOT_FOUND','Buch nicht gefunden.');await prisma.bookmark.upsert({where:{userId_bookId:{userId:user.id,bookId}},create:{userId:user.id,bookId},update:{}});return {bookmarked:true}});
  app.delete('/api/me/bookmarks/:id',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;await prisma.bookmark.deleteMany({where:{userId:user.id,bookId:params(req)}});return {bookmarked:false}});
  app.get('/api/me/progress',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;return {progress:await prisma.readingProgress.findMany({where:{userId:user.id},include:{book:true,chapter:true},orderBy:{updatedAt:'desc'}})}});
  app.put('/api/me/progress/:id',async(req,reply)=>{const user=await auth(req,reply);if(!user)return;const bookId=params(req);const {chapterId}=z.object({chapterId:z.string().uuid()}).parse(req.body);const chapter=await prisma.chapter.findFirst({where:{id:chapterId,bookId,status:'PUBLISHED',book:{status:'PUBLISHED',series:{status:'PUBLISHED'}}}});if(!chapter)return fail(reply,404,'NOT_FOUND','Kapitel nicht gefunden.');const progress=await prisma.readingProgress.upsert({where:{userId_bookId:{userId:user.id,bookId}},create:{userId:user.id,bookId,chapterId},update:{chapterId}});return {progress}});

  app.get('/api/admin/series',async(req,reply)=>{if(!await auth(req,reply,true))return;const rows=await prisma.series.findMany({include:{books:{include:{chapters:{orderBy:{sortOrder:'asc'}}},orderBy:[{sortOrder:'asc'},{volumeNumber:'asc'}]}},orderBy:[{sortOrder:'asc'},{title:'asc'}]});return {series:rows.map(s=>({...s,books:s.books.map(mapBook)}))}});
  app.post('/api/admin/series',async(req,reply)=>{if(!await auth(req,reply,true))return;return {series:await prisma.series.create({data:seriesInput.parse(req.body)})}});
  app.put('/api/admin/series/:id',async(req,reply)=>{if(!await auth(req,reply,true))return;return {series:await prisma.series.update({where:{id:params(req)},data:seriesInput.partial().parse(req.body)})}});
  app.delete('/api/admin/series/:id',async(req,reply)=>{if(!await auth(req,reply,true))return;await prisma.series.delete({where:{id:params(req)}});return {ok:true}});
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
  app.get('/api/admin/users',async(req,reply)=>{if(!await auth(req,reply,true))return;return {users:(await prisma.user.findMany({orderBy:{createdAt:'asc'}})).map(publicUser)}});
  app.post('/api/admin/users',async(req,reply)=>{if(!await auth(req,reply,true))return;const {password,...data}=userInput.parse(req.body);const user=await prisma.user.create({data:{...data,passwordHash:await argon2.hash(password)}});return {user:publicUser(user)}});
  app.put('/api/admin/users/:id',async(req,reply)=>{const actor=await auth(req,reply,true);if(!actor)return;const id=params(req);const data=userInput.partial().parse(req.body);if(id===actor.id&&data.active===false)return fail(reply,400,'SELF_DEACTIVATION','Das eigene Konto kann nicht deaktiviert werden.');const {password,...rest}=data;const user=await prisma.user.update({where:{id},data:{...rest,...(password&&{passwordHash:await argon2.hash(password)})}});if(data.active===false)await prisma.session.deleteMany({where:{userId:id}});return {user:publicUser(user)}});
  app.delete('/api/admin/users/:id',async(req,reply)=>{const actor=await auth(req,reply,true);if(!actor)return;const id=params(req);if(id===actor.id)return fail(reply,400,'SELF_DELETE','Das eigene Konto kann nicht gelöscht werden.');await prisma.user.delete({where:{id}});return {ok:true}});
  app.addHook('onClose',()=>prisma.$disconnect());return app;
}

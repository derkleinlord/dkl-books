import {PrismaClient} from '@prisma/client';
import argon2 from 'argon2';
import {config} from './config.js';
config();
const name=process.env.BOOTSTRAP_ADMIN_NAME,username=process.env.BOOTSTRAP_ADMIN_USERNAME?.toLowerCase(),password=process.env.BOOTSTRAP_ADMIN_PASSWORD;
if(!name||!username||!password||password.length<8)throw new Error('BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_USERNAME und ein Passwort mit mindestens 8 Zeichen sind erforderlich.');
const prisma=new PrismaClient();
const existing=await prisma.user.findUnique({where:{username}});if(existing)throw new Error('Dieser Benutzername existiert bereits.');
await prisma.user.create({data:{name,username,passwordHash:await argon2.hash(password),role:'ADMIN'}});await prisma.$disconnect();console.log(`Administrator ${username} wurde angelegt.`);

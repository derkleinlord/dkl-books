import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {config} from './config.js';

config();
const args=process.argv.slice(2);
if(!args.length)throw new Error('Prisma-Unterbefehl fehlt.');
const executable=path.resolve('node_modules/.bin/prisma');
const result=spawnSync(executable,args,{stdio:'inherit',env:process.env});
process.exit(result.status??1);

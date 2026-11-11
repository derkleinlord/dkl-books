import {buildApp} from './app.js';
import {config} from './config.js';
const cfg=config();const app=buildApp();
app.listen({port:cfg.PORT,host:cfg.HOST}).catch(err=>{app.log.error(err);process.exit(1)});

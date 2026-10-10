import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const required=['ACCESS_TEAM_DOMAIN','ACCESS_AUD','ALLOWED_EMAILS'];
if(config.d1_databases[0].database_id.startsWith('00000000')||required.some(k=>!config.vars[k])||config.vars.LOCAL_DEV!=='false'){
 console.error('Deployment is not configured. Set a real D1 database ID, Cloudflare Access team/audience and allowed emails. LOCAL_DEV must remain false. See README.md.');process.exit(1);
}
const r=spawnSync('npx',['wrangler','deploy'],{stdio:'inherit'});process.exit(r.status??1);

import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';

export async function createTestEnvironment(name='audit-'+Date.now()){
 const root=resolve('.'),directory=join(root,'work',name);
 await mkdir(directory,{recursive:true,mode:0o700});
 const config=JSON.parse(await readFile(join(root,'wrangler.jsonc'),'utf8'));
 config.main=join(root,config.main);config.assets.directory=join(root,config.assets.directory);
 config.d1_databases=config.d1_databases.map(db=>({...db,migrations_dir:join(root,db.migrations_dir)}));
 config.vars={LOCAL_DEV:'true',BACKUPS_ENABLED:'false',MARKETPLACE_CONNECTIONS_ENABLED:'false',EBAY_ENVIRONMENT:'sandbox',RESEARCH_MODEL:'fixture',TRANSCRIPTION_MODEL:'fixture',DAILY_AI_JOBS:'30'};
 delete config.account_id;delete config.triggers;delete config.observability;
 const configPath=join(directory,'wrangler.json'),persist=join(directory,'state');
 await writeFile(configPath,JSON.stringify(config,null,2),{mode:0o600});
 // An explicit empty vars file prevents loading the developer's API credentials.
 await writeFile(join(directory,'.dev.vars'),'# Isolated checks: no external credentials.\n',{mode:0o600});
 return {directory,config:configPath,persist};
}
if(process.argv[1]?.endsWith('/test-environment.mjs'))console.log(JSON.stringify(await createTestEnvironment(process.argv[2])));

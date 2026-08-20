#!/usr/bin/env node
import fs from 'node:fs';
import manifest from '../supabase/introspection/serviceos_foundation_manifest.json' with { type: 'json' };
const source=process.argv[2]?fs.readFileSync(process.argv[2],'utf8'):fs.readFileSync(0,'utf8');
let rows;try{rows=JSON.parse(source)}catch{console.error('foundation evidence must be a JSON array');process.exit(1)}
const fail=m=>{console.error(`foundation evidence rejected: ${m}`);process.exit(1)};
if(!Array.isArray(rows))fail('top level must be an array');
const relations=rows.filter(x=>x?.section==='relation');
for(const name of manifest.foundation){const r=relations.find(x=>x.object_name===name);if(!r)fail(`missing relation ${name}`);if(r.definition?.rls_enabled!==true)fail(`RLS is not enabled for ${name}`)}
const requiredSections=['column','constraint','index','policy','grant','trigger','function'];
for(const section of requiredSections)if(!rows.some(x=>x?.section===section))fail(`missing ${section} evidence`);
const triggerCount=rows.filter(x=>x?.section==='trigger').length;if(triggerCount!==16)fail(`expected 16 triggers, found ${triggerCount}`);
for(const identity of ['current_app_user_id()','is_org_member(uuid)','is_business_unit_member(uuid)','has_org_role(uuid,text[])','has_bu_role(uuid,uuid,text[])']){
 const f=rows.find(x=>x?.section==='function'&&String(x.definition?.identity||'').replaceAll(' ','')===identity);if(!f)fail(`missing helper ${identity}`);if(f.definition?.security_definer!==true)fail(`${identity} is not SECURITY DEFINER`);const config=f.definition?.configuration||[];if(!config.some(x=>/^search_path=/.test(x)))fail(`${identity} lacks explicit search_path`);
}
const serialized=JSON.stringify(rows);if(/eyJhbGci|password|service_role_key|anon_key/i.test(serialized))fail('possible credential material present');
console.log(JSON.stringify({status:'PASS',relations:relations.length,triggers:triggerCount,rows:rows.length}));

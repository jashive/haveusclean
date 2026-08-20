import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const run=(env,args=[])=>spawnSync(process.execPath,['scripts/serviceos-acceptance-preflight.mjs',...args],{env:{PATH:process.env.PATH,...env},encoding:'utf8'});
test('preflight rejects missing target',()=>assert.notEqual(run({}).status,0));
test('preflight rejects production target',()=>{const r=run({SUPABASE_URL:'https://opazwghrohmfykzxxsjk.supabase.co'});assert.notEqual(r.status,0);assert.match(r.stderr,/prohibited/)});
test('preflight rejects unknown project',()=>assert.notEqual(run({SUPABASE_URL:'https://aaaaaaaaaaaaaaaaaaaa.supabase.co'}).status,0));
test('preflight permits approved acceptance read-only target',()=>assert.equal(run({SUPABASE_URL:'https://hqeamecwdsrjfjybrsox.supabase.co'}).status,0));
test('preflight requires separate mutation approval',()=>assert.notEqual(run({SUPABASE_URL:'https://hqeamecwdsrjfjybrsox.supabase.co'},['--mutation']).status,0));
test('preflight permits explicitly approved acceptance mutation',()=>assert.equal(run({SUPABASE_URL:'https://hqeamecwdsrjfjybrsox.supabase.co',SERVICEOS_ACCEPTANCE_MUTATIONS_APPROVED:'true'},['--mutation']).status,0));

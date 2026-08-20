import test from 'node:test';
import assert from 'node:assert/strict';
import { getSupabaseConfig, ACCEPTANCE_SUPABASE_PROJECT_REF, PRODUCTION_SUPABASE_PROJECT_REF } from '../src/lib/supabaseConfig.js';
import { requireServiceosServerTarget } from '../src/server/serviceosServerEnvironment.js';
const key = 'test-key-not-a-secret';
test('preview missing config remains disconnected and never resolves production',()=>{const c=getSupabaseConfig({VERCEL_ENV:'preview'});assert.equal(c.isConfigured,false);assert.equal(c.projectRef,null);assert.equal(c.url,'')});
test('acceptance explicit configuration resolves approved project',()=>{const c=getSupabaseConfig({VITE_SERVICEOS_ENVIRONMENT:'acceptance',VITE_VERCEL_ENV:'preview',VITE_SUPABASE_URL:`https://${ACCEPTANCE_SUPABASE_PROJECT_REF}.supabase.co`,VITE_SUPABASE_ANON:key});assert.equal(c.projectRef,ACCEPTANCE_SUPABASE_PROJECT_REF);assert.equal(c.isAcceptance,true);assert.equal(c.providerEnvironment,'preview')});
test('malformed configuration fails closed',()=>assert.throws(()=>getSupabaseConfig({VITE_SUPABASE_URL:'http://example.test',VITE_SUPABASE_ANON:key}),/HTTPS/));
test('preview can never target production even when client flags claim production approval',()=>assert.throws(()=>getSupabaseConfig({VERCEL_ENV:'preview',VITE_SERVICEOS_ENVIRONMENT:'production',VITE_SERVICEOS_PRODUCTION_APPROVED:'true',VITE_SUPABASE_URL:`https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,VITE_SUPABASE_ANON:key}),/Preview|forbidden/i));
test('vite provider preview can never target production even when client flags claim production approval',()=>assert.throws(()=>getSupabaseConfig({VITE_VERCEL_ENV:'preview',VITE_SERVICEOS_ENVIRONMENT:'production',VITE_SERVICEOS_PRODUCTION_APPROVED:'true',VITE_SUPABASE_URL:`https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,VITE_SUPABASE_ANON:key}),/Preview|forbidden/i));
test('acceptance requires provider-reported preview when provider environment is present',()=>assert.throws(()=>getSupabaseConfig({VITE_VERCEL_ENV:'production',VITE_SERVICEOS_ENVIRONMENT:'acceptance',VITE_SUPABASE_URL:`https://${ACCEPTANCE_SUPABASE_PROJECT_REF}.supabase.co`,VITE_SUPABASE_ANON:key}),/Preview/));
test('production requires explicit approval and provider-reported production',()=>{const base={VERCEL_ENV:'production',VITE_SERVICEOS_ENVIRONMENT:'production',VITE_SUPABASE_URL:`https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,VITE_SUPABASE_ANON:key};assert.throws(()=>getSupabaseConfig(base),/forbidden/);assert.equal(getSupabaseConfig({...base,VITE_SERVICEOS_PRODUCTION_APPROVED:'true'}).projectRef,PRODUCTION_SUPABASE_PROJECT_REF)});

test('server preview/test requires the exact Acceptance project',()=>{
  const env={SERVICEOS_ENVIRONMENT:'preview',SUPABASE_URL:`https://${ACCEPTANCE_SUPABASE_PROJECT_REF}.supabase.co`};
  assert.equal(requireServiceosServerTarget(env,{allowProduction:false}).projectRef,ACCEPTANCE_SUPABASE_PROJECT_REF);
  assert.throws(()=>requireServiceosServerTarget({...env,SUPABASE_URL:`https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`},{allowProduction:false}),/Acceptance|Production|prohibited/i);
});

test('server Production requires the exact Production project and explicit approval',()=>{
  const base={SERVICEOS_ENVIRONMENT:'production',SUPABASE_URL:`https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,VERCEL_ENV:'production'};
  assert.throws(()=>requireServiceosServerTarget(base),/APPROVED|approval/i);
  assert.equal(requireServiceosServerTarget({...base,SERVICEOS_PRODUCTION_APPROVED:'true'}).projectRef,PRODUCTION_SUPABASE_PROJECT_REF);
  assert.throws(()=>requireServiceosServerTarget({...base,SERVICEOS_PRODUCTION_APPROVED:'true',SUPABASE_URL:`https://${ACCEPTANCE_SUPABASE_PROJECT_REF}.supabase.co`}),/Production.*project/i);
});

test('server provider environment cannot cross-wire Production and Acceptance',()=>{
  assert.throws(()=>requireServiceosServerTarget({SERVICEOS_ENVIRONMENT:'preview',VERCEL_ENV:'production',SUPABASE_URL:`https://${ACCEPTANCE_SUPABASE_PROJECT_REF}.supabase.co`}),/Vercel Production/i);
  assert.throws(()=>requireServiceosServerTarget({SERVICEOS_ENVIRONMENT:'production',VERCEL_ENV:'preview',SERVICEOS_PRODUCTION_APPROVED:'true',SUPABASE_URL:`https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`}),/non-production Vercel/i);
});

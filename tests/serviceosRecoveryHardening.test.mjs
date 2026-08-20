import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveCanonicalIdentity, workspaceForRole, CANONICAL_ROLES } from '../src/lib/serviceosRolePolicy.js';
import { authorizeOperation, WORKER_EVENTS } from '../src/lib/serviceosWorkflowPolicy.js';
import { createAcceptanceEnvelope, propagateAcceptanceEnvelope, assertCleanupOwnership, ACCEPTANCE_STAGES } from '../src/lib/serviceosAcceptance.js';

const org='10000000-0000-4000-8000-000000000001', bu='20000000-0000-4000-8000-000000000001', runId='30000000-0000-4000-8000-000000000001';
const input=(role='owner_admin')=>({authUserId:'auth',organizationId:org,appUsers:[{id:'user',auth_user_id:'auth',status:'active'}],roles:[{id:'role',code:role}],memberships:[{app_user_id:'user',organization_id:org,business_unit_id:bu,role_id:'role',status:'active'}],workers:role==='worker'?[{id:'worker',app_user_id:'user',organization_id:org,business_unit_id:bu,status:'active'}]:[],visibleBusinessUnitIds:[bu]});

test('canonical roles are exact',()=>assert.deepEqual(CANONICAL_ROLES,['owner_admin','office_ops','worker','qa']));
for(const role of CANONICAL_ROLES)test(`resolves ${role}`,()=>assert.equal(resolveCanonicalIdentity(input(role)).role,role));
test('same-role multi-BU is allowed',()=>{const x=input(); const bu2='20000000-0000-4000-8000-000000000002'; x.memberships.push({...x.memberships[0],business_unit_id:bu2});x.visibleBusinessUnitIds.push(bu2);assert.equal(resolveCanonicalIdentity(x).allowedBusinessUnitIds.length,2)});
for(const [name,mutate] of [['missing membership',x=>x.memberships=[]],['other org',x=>x.memberships[0].organization_id='other'],['unsupported role',x=>x.roles[0].code='admin'],['mixed role',x=>{x.roles.push({id:'qa',code:'qa'});x.memberships.push({...x.memberships[0],role_id:'qa'})}],['invisible BU',x=>x.visibleBusinessUnitIds=[]],['non-worker link',x=>x.workers=[{app_user_id:'user',status:'active'}]]])test(`rejects ${name}`,()=>{const x=input();mutate(x);assert.throws(()=>resolveCanonicalIdentity(x))});
test('worker exact link is required',()=>{const x=input('worker');x.workers=[];assert.throws(()=>resolveCanonicalIdentity(x))});
test('owner workspace does not impersonate worker or QA',()=>{const w=workspaceForRole('owner_admin');assert.equal(w.workerAssignments,false);assert.equal(w.qaEligibleJobs,false);assert.equal(w.finance,true)});

test('office controls scheduling',()=>{const identity=resolveCanonicalIdentity(input());assert.equal(authorizeOperation({identity,action:'schedule',resource:{organization_id:org,identity_organization_id:org,business_unit_id:bu}}),true)});
test('worker events are allowlisted',()=>assert.deepEqual(WORKER_EVENTS,['acknowledged','started','checklist_updated','evidence_added','completed']));
test('worker must own exact assignment',()=>{const identity=resolveCanonicalIdentity(input('worker'));const resource={organization_id:org,identity_organization_id:org,business_unit_id:bu,assigned_worker_id:'other'};assert.equal(authorizeOperation({identity,action:'started',resource}),false);resource.assigned_worker_id='worker';assert.equal(authorizeOperation({identity,action:'started',resource}),true)});
test('QA requires eligibility and failed status for correction',()=>{const identity=resolveCanonicalIdentity(input('qa'));const resource={organization_id:org,identity_organization_id:org,business_unit_id:bu,qa_eligible:true,qa_status:'failed'};assert.equal(authorizeOperation({identity,action:'qa_pass',resource}),true);assert.equal(authorizeOperation({identity,action:'corrective_action',resource}),true);resource.qa_status='passed';assert.equal(authorizeOperation({identity,action:'corrective_action',resource}),false)});

test('corrective-action worker validation bypasses worker RLS only inside locked trigger validator',()=>{
  const hardening=fs.readFileSync('supabase/migrations/20260818040000_serviceos_role_workflow_hardening.sql','utf8');
  const baseline=fs.readFileSync('supabase/migrations/001_serviceos_foundation_baseline.sql','utf8');
  assert.match(hardening,/create or replace function public\.wave3_validate_ca_scope\(\)[\s\S]*security definer[\s\S]*set search_path = ''/i);
  assert.match(hardening,/select \* into v_aw from public\.worker where id = new\.assigned_worker_id/i);
  assert.match(hardening,/v_aw\.organization_id is distinct from new\.organization_id/i);
  assert.match(hardening,/v_aw\.business_unit_id is distinct from new\.business_unit_id/i);
  assert.match(hardening,/revoke all on function public\.wave3_validate_ca_scope\(\) from public,anon,authenticated/i);
  assert.doesNotMatch(hardening,/grant execute on function public\.wave3_validate_ca_scope\(\) to authenticated/i);
  assert.match(baseline,/worker_self_or_staff_select ON worker FOR SELECT TO authenticated USING \(app_user_id=current_app_user_id\(\) OR has_bu_role\(organization_id,business_unit_id,ARRAY\['owner_admin','office_ops'\]\)\)/);
  assert.doesNotMatch(baseline,/worker_self_or_staff_select[\s\S]{0,250}'qa'/i);
});

test('acceptance is explicit and canonical',()=>{const e=createAcceptanceEnvelope({acceptanceMode:true,runId,scenario:'worker-complete',organizationId:org,businessUnitId:bu});assert.equal(e.runName,`TEST-W6-worker-complete-${runId}`)});
test('ordinary mode cannot create TEST-W6 metadata',()=>assert.throws(()=>createAcceptanceEnvelope({acceptanceMode:false,runId,scenario:'x',organizationId:org,businessUnitId:bu})));
test('scenario is strict kebab-case',()=>assert.throws(()=>createAcceptanceEnvelope({acceptanceMode:true,runId,scenario:'Bad Name',organizationId:org,businessUnitId:bu})));
test('all lifecycle stages are represented',()=>assert.equal(ACCEPTANCE_STAGES.length,11));
test('metadata propagates and cleanup verifies exact ownership',()=>{const e=createAcceptanceEnvelope({acceptanceMode:true,runId,scenario:'cleanup',organizationId:org,businessUnitId:bu});const row=propagateAcceptanceEnvelope({organization_id:org,business_unit_id:bu},e);assert.equal(assertCleanupOwnership(e,row),true);assert.throws(()=>assertCleanupOwnership(e,{...row,organization_id:'other'}))});

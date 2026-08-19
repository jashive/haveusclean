#!/usr/bin/env node
import { ACCEPTANCE_SUPABASE_PROJECT_REF, PRODUCTION_SUPABASE_PROJECT_REF } from '../src/lib/supabaseConfig.js';

const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const mutate = process.argv.includes('--mutation');
const match = url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/i);
const fail = (message) => { process.stderr.write(`ServiceOS acceptance preflight: ${message}\n`); process.exit(1); };
if (!match) fail('an explicit HTTPS Supabase project URL is required');
const ref = match[1].toLowerCase();
if (ref === PRODUCTION_SUPABASE_PROJECT_REF) fail('production project is prohibited');
if (ref !== ACCEPTANCE_SUPABASE_PROJECT_REF) fail('target is not the approved acceptance project');
if (mutate && process.env.SERVICEOS_ACCEPTANCE_MUTATIONS_APPROVED !== 'true') fail('mutation approval is required');
process.stdout.write(JSON.stringify({ status:'PASS', projectRef:ref, mutationApproved:mutate }, null, 2)+'\n');

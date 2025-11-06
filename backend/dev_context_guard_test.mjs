#!/usr/bin/env node
// Tiny sanity harness for context_guard
import assert from 'node:assert/strict';
import { isHeaderLine, isNonPatientLine, isLikelyProviderLine, isFaxLike, stripAddressTail, hasPatientContext, contextScore } from './rules/context_guard.js';

function run() {
  const cases = [];
  cases.push(['header: cover sheet', isHeaderLine('FAX COVER SHEET'), true]);
  cases.push(['non-patient: insurance auth', isNonPatientLine('Insurance Authorization Request'), true]);
  cases.push(['provider-like: ordering provider', isLikelyProviderLine('Ordering Provider: John Doe, MD'), true]);
  cases.push(['fax-like: Fax: (555) 123-4567', isFaxLike('Fax: (555) 123-4567'), true]);
  cases.push(['patient ctx: Patient Information', hasPatientContext('Patient Information / Contact'), true]);
  cases.push(['strip address tail', stripAddressTail('Sleep Center of City 123 Main St Suite 200'), 'Sleep Center of City']);
  cases.push(['provider from header', isLikelyProviderLine('From: Family Practice Clinic'), true]);
  cases.push(['patient info header', hasPatientContext('Patient Info: Jane Doe (H:)'), true]);
  const cs = contextScore('From: Family Practice Clinic');
  cases.push(['contextScore provider flag', cs.provider === 1, true]);

  let pass = 0, fail = 0;
  for (const [name, got, expected] of cases) {
    try {
      if (typeof expected === 'boolean') assert.equal(!!got, expected);
      else assert.equal(got, expected);
      pass++;
    } catch (e) {
      console.error('FAIL:', name, '=>', got, 'expected', expected);
      fail++;
    }
  }
  console.log(JSON.stringify({ pass, fail }));
  process.exit(fail ? 1 : 0);
}

run();

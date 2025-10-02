import test from 'node:test';
import assert from 'node:assert/strict';
import { runExtraction } from '../backend/rules/index.js';

// Randomized noise generator around phone and email tokens
function randomSep() {
  const pool = [' ', '  ', '\t', ' - ', ' : ', ' | ', ' ~ ', ' * ', ' /// '];
  return pool[Math.floor(Math.random() * pool.length)];
}

function makeSample(i) {
  const basePhone = '(555) 234-45' + (i%10) + (i%10);
  const altPhone = '555.' + (200 + i) + '.7' + (300 + i).toString().slice(0,3);
  const junk = ['#','@','!!','>>>','[x]','(note)','{ref}','/','\\'].sort(()=>0.5-Math.random()).slice(0,3).join(' ');
  const patientEmail = `patient${i}@example.com`;
  const businessEmail = `office${i}@facility.org`;
  return `Patient${randomSep()}John${randomSep()}Doe${randomSep()}DOB${randomSep()}01/02/1970\n${junk}\nPhone${randomSep()}${basePhone}${randomSep()}alt${randomSep()}${altPhone}\nEmail:${randomSep()}${businessEmail}\nPatient Email${randomSep()}${patientEmail}\nRequest 95810 polysomnography.`;
}

test('randomized phone/email noise extraction robustness', () => {
  const ITER = 20;
  for (let i=0;i<ITER;i++) {
    const text = makeSample(i);
    const { result } = runExtraction([{ text }]);
    assert.ok(result.patient?.phones && result.patient.phones.length >= 1, 'primary phone missing');
    const phone = result.patient.phones[0];
    assert.match(phone, /^\(555\) \d{3}-\d{4}$/,'phone normalization format unexpected');
    if (result.patient.altPhones) {
      assert.ok(result.patient.altPhones.length >= 1, 'expected alt phone captured');
    }
    // Business email should not override patient email
    if (result.patient.email) {
      assert.match(result.patient.email, /@example\.com$/,'patient email domain mismatch');
      assert.ok(!/facility\.org$/.test(result.patient.email), 'business email incorrectly selected');
    }
  }
});

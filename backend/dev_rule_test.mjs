#!/usr/bin/env node
import { runExtractionWithDates } from './rules/index.js';

// Craft a synthetic page with an insurance block and candidate IDs
const text = `
Referral Form

Primary Insurance: Aetna PPO
Member ID: W295408488
Group ID: 12345
Subscriber: John Doe

Patient Name: John Q Public
DOB: 01/02/1970
Phone: (555) 123-4567
`;

const ocrPages = [
  {
    page: 1,
    text,
    boxes: [
      { text: 'Primary Insurance: Aetna PPO', conf: 0.99, bbox: [10,10,200,20] },
      { text: 'Member ID: W295408488', conf: 0.99, bbox: [10,35,200,20] },
      { text: 'Group ID: 12345', conf: 0.99, bbox: [10,60,200,20] },
      { text: 'Patient Name: John Q Public', conf: 0.99, bbox: [10,100,250,20] },
      { text: 'DOB: 01/02/1970', conf: 0.99, bbox: [10,125,150,20] },
    ]
  }
];

const { result, trace } = await runExtractionWithDates(ocrPages);

console.log(JSON.stringify({
  insurance: result.insurance,
  chosenMemberId: result.insurance?.[0]?.memberId || null,
  carrier: result.insurance?.[0]?.carrier || null,
  trace: trace.filter(t => String(t.rule).includes('insurance_id')).slice(0, 8)
}, null, 2));

// Scenario 2: Short numeric member ID, carrier-specific alphanumeric elsewhere -> expect upgrade
const text2 = `
Referral Form

Primary Insurance: Aetna PPO
Member ID: 22614
Group ID: 999
Subscriber: Jane Doe

Other section text...
Notes:
 - lorem ipsum
 - dolor sit amet
 - consectetur adipiscing elit
 - sed do eiusmod tempor
 - incididunt ut labore et dolore magna aliqua

Insurance: Aetna
Insurance ID: W295408488
`;

const ocrPages2 = [
  { page: 1, text: text2, boxes: [] }
];

const { result: result2, trace: trace2 } = await runExtractionWithDates(ocrPages2);

console.log(JSON.stringify({
  scenario: 2,
  insurance: result2.insurance,
  chosenMemberId: result2.insurance?.[0]?.memberId || null,
  carrier: result2.insurance?.[0]?.carrier || null,
  trace: trace2.filter(t => String(t.rule).includes('insurance_id'))
}, null, 2));

// Scenario 3: Anthem with unlabeled carrier-style ID elsewhere -> expect carrier_pattern selection
const text3 = `
Referral Form

Primary Insurance: Anthem
Member ID: 123456

Random text ...
Claim ref ABC
XYY123456789
`;

const { result: result3, trace: trace3 } = await runExtractionWithDates([{ page: 1, text: text3, boxes: [] }]);

console.log(JSON.stringify({
  scenario: 3,
  insurance: result3.insurance,
  chosenMemberId: result3.insurance?.[0]?.memberId || null,
  carrier: result3.insurance?.[0]?.carrier || null,
  trace: trace3.filter(t => String(t.rule).includes('insurance_id'))
}, null, 2));

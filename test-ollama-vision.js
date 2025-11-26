import fs from 'fs';
import fetch from 'node-fetch';

// Test if Ollama can read a medical document image with HIGHER RESOLUTION
const testImagePath = '/Users/agyhernandez/Desktop/medocr/data/temp/525603bece7871e60eb79195909504ed_page_3.png';

console.log('Testing Ollama vision with HIGHER RES IMAGE:', testImagePath);
console.log('Image size:', (fs.statSync(testImagePath).size / 1024).toFixed(0) + 'KB');

const imageBase64 = fs.readFileSync(testImagePath, { encoding: 'base64' });

const simpleTest = async () => {
  console.log('\n=== TEST 1: Simple text recognition ===');
  const resp1 = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llava:13b',
      prompt: 'List the first 20 words you see on this document.',
      images: [imageBase64],
      stream: false
    })
  });
  const data1 = await resp1.json();
  console.log('Response:', data1.response);
};

const problemsTest = async () => {
  console.log('\n=== TEST 2: Problems section detection ===');
  const resp2 = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llava:13b',
      prompt: 'Do you see a section labeled "Problems" or "Reviewed Problems" on this page? If yes, what conditions are listed?',
      images: [imageBase64],
      stream: false
    })
  });
  const data2 = await resp2.json();
  console.log('Response:', data2.response);
};

await simpleTest();
await problemsTest();

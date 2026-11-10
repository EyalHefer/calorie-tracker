// בדיקות לשרת (src/worker.js). להרצה: npm test
// לא פונים באמת ל-Gemini: מחליפים את fetch בפונקציה מזויפת (mock) שזוכרת מה נשלח אליה
// ומחזירה תשובה קבועה. ככה הבדיקות מהירות, חינמיות, ולא תלויות באינטרנט.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const ENV = { GEMINI_API_KEY: "test-key" };
const ITEMS = [{ name: "צלחת פסטה", calories: 450, protein: 14 }];
// base64 קצר ותקין. לשרת לא משנה שזו לא תמונה אמיתית, את זה בודק Gemini.
const IMAGE = { mimeType: "image/jpeg", data: "aGVsbG8=" };

const realFetch = globalThis.fetch;
let sentToGemini;

beforeEach(() => {
  sentToGemini = [];
  globalThis.fetch = async (url, options) => {
    sentToGemini.push(JSON.parse(options.body));
    const geminiBody = { candidates: [{ content: { parts: [{ text: JSON.stringify({ items: ITEMS }) }] } }] };
    return new Response(JSON.stringify(geminiBody), { status: 200 });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function estimate(body) {
  const request = new Request("https://example.com/api/estimate", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return worker.fetch(request, ENV);
}

test("טקסט בלבד: עובד כמו קודם, בלי תמונה בבקשה", async () => {
  const response = await estimate({ text: "פסטה" });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items, ITEMS);
  assert.deepEqual(sentToGemini[0].contents[0].parts, [{ text: "פסטה" }]);
});

test("תמונה בלבד: נשלחת ל-Gemini כ-inlineData, עם הוראות התמונה", async () => {
  const response = await estimate({ image: IMAGE });
  assert.equal(response.status, 200);
  assert.deepEqual(sentToGemini[0].contents[0].parts, [{ inlineData: IMAGE }]);
  assert.match(sentToGemini[0].systemInstruction.parts[0].text, /תמונה/);
});

test("תמונה + הערה: שתיהן נשלחות", async () => {
  await estimate({ text: "  אכלתי חצי  ", image: IMAGE });
  assert.deepEqual(sentToGemini[0].contents[0].parts, [{ inlineData: IMAGE }, { text: "אכלתי חצי" }]);
});

test("בקשות לא תקינות נדחות (400) ולא מגיעות ל-Gemini", async () => {
  const invalid = [
    "זה לא JSON",
    {},
    { text: "   " },
    { text: "א".repeat(501) },
    { image: { mimeType: "image/gif", data: "aGVsbG8=" } },
    { image: { mimeType: "image/jpeg", data: "" } },
    { image: { mimeType: "image/jpeg", data: "<script>" } },
    { image: { mimeType: "image/jpeg", data: "A".repeat(2_000_001) } },
    { image: null },
  ];
  for (const body of invalid) {
    const response = await estimate(body);
    assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(body).slice(0, 60)}`);
  }
  assert.equal(sentToGemini.length, 0);
});

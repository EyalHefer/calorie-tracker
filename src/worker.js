// =====================================================================
// צד השרת: Cloudflare Worker
// הקוד הזה רץ בשרתים של Cloudflare ולא בדפדפן, ולכן מותר לו להחזיק את מפתח ה-API.
// הדפדפן שולח לכאן טקסט ("מה אכלתי") ו/או תמונה של האוכל, אנחנו מעבירים אותם ל-Gemini
// ומחזירים לדפדפן רשימת פריטים עם קלוריות.
//
// קבצים סטטיים (index.html, style.css, app.js) מוגשים אוטומטית מתיקיית public,
// והקוד כאן רץ רק לכתובות שאין להן קובץ, כמו /api/estimate.
// =====================================================================

// רשימת מודלים לפי סדר עדיפות. אם מודל עמוס (503), חרג ממכסה (429), הוסר (404)
// או לא ענה בזמן, מנסים את הבא. גוגל מחליפה מודלים לעיתים קרובות, ולכן כדאי לא להיות תלויים באחד.
// המודלים עם "latest" הם כינויים שגוגל מעדכנת לבד למודל העדכני.
// מודלי ה-lite ראשונים: במדידות הם ענו הכי מהר, וההערכה שלהם מספיק טובה לקלוריות.
const MODELS = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.8-flash", "gemini-flash-latest"];
const RETRYABLE_STATUSES = [404, 429, 503];
// בשכבה החינמית מודל עמוס יכול "להיתקע" גם דקה ויותר, אז לא מחכים לו יותר מזה
const ATTEMPT_TIMEOUT_MS = 15000;

function geminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

// ההוראות למודל. ככל שההוראות מדויקות יותר, התשובות עקביות יותר.
const INSTRUCTIONS = `אתה עוזר תזונה. המשתמשת תתאר בעברית מה היא אכלה.
פרק את התיאור לפריטי מזון נפרדים והערך כמה קלוריות וכמה גרם חלבון יש בכל פריט.
אם לא צוינה כמות, הנח מנה סטנדרטית ומקובלת בישראל.
כתוב את שם כל פריט בעברית, כולל הכמות שהנחת (למשל "2 פרוסות לחם מלא").`;

// תוספת להוראות כשמגיעה תמונה. מתמונה קשה לדעת כמויות, אז מבקשים מהמודל
// להיעזר בגודל הצלחת והכלים, ולהעדיף את מה שהמשתמשת כתבה על פני מה שנראה.
const IMAGE_INSTRUCTIONS = `
לפעמים תקבל תמונה של האוכל. זהה את המאכלים שבתמונה והערך את הכמות לפי גודל הצלחת, הכלים והפרופורציות.
אם יש גם טקסט, הוא מדויק יותר מהתמונה: השתמש בו כדי לתקן את הזיהוי או את הכמות.
אם אין בתמונה אוכל, החזר רשימה ריקה.`;

// מגבלות קלט. הדפדפן מקטין את התמונה לפני השליחה (בערך 200KB),
// אז המגבלה כאן נדיבה ורק מגינה מפני בקשות ענקיות.
const MAX_TEXT_LENGTH = 500;
const MAX_IMAGE_BASE64_LENGTH = 2_000_000; // בערך 1.5MB של תמונה
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

// סכמה (Schema) שמכריחה את המודל להחזיר JSON במבנה קבוע,
// כדי שהקוד שלנו יוכל לסמוך על המבנה במקום לנחש איך התשובה תיראה.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          calories: { type: "integer" },
          // גרמים של חלבון. number ולא integer, כי ביצה למשל היא 6.5 גרם
          protein: { type: "number" },
        },
        required: ["name", "calories", "protein"],
      },
    },
  },
  required: ["items"],
};

export default {
  // כל בקשה שמגיעה לשרת עוברת בפונקציה הזו
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/estimate" && request.method === "POST") {
      return handleEstimate(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleEstimate(request, env) {
  // 1. בדיקת הקלט: אף פעם לא סומכים על מה שמגיע מהדפדפן
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "הבקשה לא תקינה" }, 400);
  }
  const input = validateInput(body);
  if (input.error) {
    return jsonResponse({ error: input.error }, 400);
  }

  // 2. שליחה ל-Gemini, עם מעבר למודל הבא ברשימה אם יש תקלה זמנית
  const geminiResponse = await callGeminiWithFallback(buildRequest(input), env.GEMINI_API_KEY);
  if (!geminiResponse) {
    return jsonResponse({ error: "שירות ה-AI לא זמין כרגע, נסי שוב עוד מעט" }, 502);
  }

  // 3. חילוץ התשובה. Gemini מחזיר את ה-JSON שלנו כמחרוזת בתוך המבנה שלו.
  try {
    const data = await geminiResponse.json();
    const { items } = JSON.parse(data.candidates[0].content.parts[0].text);
    return jsonResponse({ items });
  } catch (error) {
    console.error("Could not parse Gemini response:", error);
    return jsonResponse({ error: "לא הצלחתי להבין את התשובה, נסי לנסח אחרת" }, 502);
  }
}

// הקלט יכול להיות טקסט, תמונה, או שניהם, אבל לפחות אחד מהם.
// מחזירה { text, image } נקיים, או { error } עם הודעה למשתמשת.
function validateInput(body) {
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (text.length > MAX_TEXT_LENGTH) {
    return { error: `צריך לכתוב תיאור של עד ${MAX_TEXT_LENGTH} תווים` };
  }

  let image = null;
  if (body?.image !== undefined) {
    const { mimeType, data } = body.image || {};
    // base64 מכיל רק את התווים האלה. בודקים כדי לא להעביר זבל לגוגל.
    if (!IMAGE_TYPES.includes(mimeType) || typeof data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      return { error: "התמונה לא תקינה" };
    }
    if (data.length > MAX_IMAGE_BASE64_LENGTH) {
      return { error: "התמונה גדולה מדי" };
    }
    image = { mimeType, data };
  }

  if (!text && !image) {
    return { error: "צריך לכתוב מה אכלת או לצרף תמונה" };
  }
  return { text, image };
}

// בונה את גוף הבקשה ל-Gemini. כל "part" הוא חלק בהודעה: טקסט, או תמונה (inlineData).
function buildRequest({ text, image }) {
  const parts = [];
  if (image) {
    parts.push({ inlineData: image });
  }
  if (text) {
    parts.push({ text });
  }
  return {
    systemInstruction: { parts: [{ text: image ? INSTRUCTIONS + IMAGE_INSTRUCTIONS : INSTRUCTIONS }] },
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };
}

// מחזירה את התשובה הראשונה שהצליחה, או null אם כל המודלים נכשלו.
// המפתח מגיע מ-env (מהקובץ .dev.vars או מההגדרות ב-Cloudflare), ולא כתוב בקוד עצמו.
async function callGeminiWithFallback(requestBody, apiKey) {
  for (const model of MODELS) {
    let response;
    try {
      response = await fetch(geminiUrl(model), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(requestBody),
        // מבטל את הבקשה אוטומטית אם עבר הזמן (ואז fetch זורק שגיאה)
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
    } catch (error) {
      console.error(`Gemini timeout or network error (${model}):`, error.name);
      continue;
    }

    if (response.ok) {
      return response;
    }

    // את פרטי השגיאה המלאים מדפיסים ללוג של השרת, ולא שולחים לדפדפן
    console.error(`Gemini error (${model}):`, response.status, await response.text());

    // שגיאה שלא תיפתר במודל אחר (למשל מפתח לא תקין): אין טעם להמשיך לנסות
    if (!RETRYABLE_STATUSES.includes(response.status)) {
      return null;
    }
  }
  return null;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

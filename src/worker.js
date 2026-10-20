// =====================================================================
// צד השרת: Cloudflare Worker
// הקוד הזה רץ בשרתים של Cloudflare ולא בדפדפן, ולכן מותר לו להחזיק את מפתח ה-API.
// הדפדפן שולח לכאן את הטקסט ("מה אכלתי"), אנחנו מעבירים אותו ל-Gemini
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
פרק את התיאור לפריטי מזון נפרדים והערך כמה קלוריות יש בכל פריט.
אם לא צוינה כמות, הנח מנה סטנדרטית ומקובלת בישראל.
כתוב את שם כל פריט בעברית, כולל הכמות שהנחת (למשל "2 פרוסות לחם מלא").`;

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
        },
        required: ["name", "calories"],
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
  let text;
  try {
    ({ text } = await request.json());
  } catch {
    return jsonResponse({ error: "הבקשה לא תקינה" }, 400);
  }
  if (typeof text !== "string" || !text.trim() || text.length > 500) {
    return jsonResponse({ error: "צריך לכתוב תיאור של עד 500 תווים" }, 400);
  }

  // 2. שליחה ל-Gemini, עם מעבר למודל הבא ברשימה אם יש תקלה זמנית
  const geminiResponse = await callGeminiWithFallback(text, env.GEMINI_API_KEY);
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

// מחזירה את התשובה הראשונה שהצליחה, או null אם כל המודלים נכשלו.
// המפתח מגיע מ-env (מהקובץ .dev.vars או מההגדרות ב-Cloudflare), ולא כתוב בקוד עצמו.
async function callGeminiWithFallback(text, apiKey) {
  for (const model of MODELS) {
    let response;
    try {
      response = await fetch(geminiUrl(model), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
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

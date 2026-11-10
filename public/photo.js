// =====================================================================
// הוספת אוכל מתמונה
// הזרימה: בוחרים/מצלמים תמונה → מקטינים אותה בדפדפן → שולחים לשרת (יחד עם הערה, אם יש)
// → מציגים מה ה-AI זיהה, עם אפשרות לתקן → רק אחרי אישור הפריטים נכנסים ליום.
//
// למה שלב אישור? הערכה מתמונה פחות מדויקת מטקסט (קשה לראות כמה שמן יש, או כמה גרם בצלחת),
// אז נותנים למשתמשת את המילה האחרונה במקום לשמור ישר.
//
// בניגוד לטקסט, כאן מחכים לתשובה ולא מריצים ברקע: את התמונה לא שומרים
// ב-localStorage (היא כבדה מדי), ולכן אי אפשר "להמשיך את החישוב" אחרי שיוצאים מהאתר.
// =====================================================================

// הצלע הארוכה של התמונה אחרי ההקטנה. מספיק כדי לזהות אוכל, וקטן מספיק כדי שהשליחה תהיה מהירה.
const MAX_SIDE = 1024;
const JPEG_QUALITY = 0.8;

// estimate: פונקציה ששולחת { text, image } לשרת ומחזירה רשימת פריטים
// onAdd: מקבלת את הפריטים שאושרו ומוסיפה אותם ליום
export function initPhoto({ estimate, onAdd }) {
  const input = document.getElementById("photo-input");
  const panel = document.getElementById("photo-panel");
  const preview = document.getElementById("photo-preview");
  const note = document.getElementById("photo-note");
  const analyzeButton = document.getElementById("photo-analyze");
  const actions = document.getElementById("photo-actions");
  const message = document.getElementById("photo-message");
  const review = document.getElementById("photo-review");
  const list = document.getElementById("photo-items");
  const total = document.getElementById("photo-total");

  // התמונה המוקטנת, כ-base64 (בלי הקידומת "data:image/jpeg;base64,")
  let imageData = null;

  function showMessage(text) {
    message.textContent = text;
    message.classList.toggle("hidden", !text);
  }

  function reset() {
    imageData = null;
    input.value = ""; // כדי שבחירה חוזרת של אותה תמונה תפעיל שוב את change
    note.value = "";
    preview.removeAttribute("src");
    list.innerHTML = "";
    panel.classList.add("hidden");
    review.classList.add("hidden");
    actions.classList.remove("hidden");
    analyzeButton.classList.remove("hidden");
    note.disabled = false;
    showMessage("");
  }

  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) {
      return;
    }
    reset();
    try {
      const dataUrl = await resizeImage(file);
      imageData = dataUrl.split(",")[1];
      preview.src = dataUrl;
      panel.classList.remove("hidden");
      note.focus();
    } catch {
      panel.classList.remove("hidden");
      analyzeButton.classList.add("hidden");
      showMessage("לא הצלחתי לפתוח את התמונה. אפשר לנסות תמונה אחרת.");
    }
  });

  analyzeButton.addEventListener("click", async () => {
    analyzeButton.disabled = true;
    analyzeButton.textContent = "מזהה...";
    showMessage("");
    review.classList.add("hidden");

    try {
      const items = await estimate({ text: note.value.trim(), image: { mimeType: "image/jpeg", data: imageData } });
      if (items.length === 0) {
        showMessage("לא זיהיתי אוכל בתמונה. אפשר לנסות תמונה אחרת, או להוסיף הערה שמתארת מה יש בצלחת.");
      } else {
        renderReview(items);
      }
    } catch (error) {
      showMessage(navigator.onLine ? error.message || "משהו השתבש, נסי שוב" : "אין חיבור לאינטרנט. זיהוי מתמונה צריך רשת.");
    } finally {
      analyzeButton.disabled = false;
      analyzeButton.textContent = "🔍 זיהוי";
    }
  });

  // מציג את מה שזוהה כשדות שאפשר לערוך: שם, קלוריות וחלבון לכל פריט
  function renderReview(items) {
    list.innerHTML = "";
    for (const item of items) {
      const li = document.createElement("li");

      const name = document.createElement("input");
      name.type = "text";
      name.className = "review-name";
      name.value = item.name;
      name.setAttribute("aria-label", "שם הפריט");

      const calories = numberField(item.calories, "קלוריות", "1");
      const protein = numberField(item.protein, "חלבון (גרם)", "0.1");

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete-button";
      remove.textContent = "✕";
      remove.setAttribute("aria-label", "הסרת הפריט");
      remove.addEventListener("click", () => {
        li.remove();
        updateTotal();
      });

      const numbers = document.createElement("div");
      numbers.className = "input-row";
      numbers.append(calories, protein, remove);
      li.append(name, numbers);
      list.append(li);
    }
    // בשלב האישור מסתירים את "זיהוי" ו"ביטול" הראשונים: יש כפתורים משלו למטה
    review.classList.remove("hidden");
    actions.classList.add("hidden");
    note.disabled = true;
    updateTotal();
  }

  // קורא את הפריטים כפי שהם עכשיו בשדות (אחרי תיקונים של המשתמשת)
  function readItems() {
    return [...list.querySelectorAll("li")]
      .map((li) => {
        const [calories, protein] = li.querySelectorAll("input[type=number]");
        return {
          name: li.querySelector(".review-name").value.trim(),
          calories: Math.round(Number(calories.value)) || 0,
          // שדה חלבון ריק = "לא ידוע", לא אפס (כמו בשאר האפליקציה)
          protein: protein.value !== "" ? Number(protein.value) : undefined,
        };
      })
      .filter((item) => item.name);
  }

  function updateTotal() {
    const items = readItems();
    const sum = items.reduce((acc, item) => acc + item.calories, 0);
    total.textContent = items.length ? `סה"כ: ${sum} קק"ל` : "לא נשארו פריטים";
    document.getElementById("photo-confirm").disabled = items.length === 0;
  }

  // כל שינוי בשדה כלשהו ברשימה מעדכן את הסכום (האירוע "מבעבע" מהשדה עד הרשימה)
  list.addEventListener("input", updateTotal);

  document.getElementById("photo-confirm").addEventListener("click", () => {
    const items = readItems();
    if (items.length > 0) {
      onAdd(items);
    }
    reset();
  });

  for (const button of document.querySelectorAll(".photo-cancel")) {
    button.addEventListener("click", reset);
  }
}

// שדה מספר עם כותרת קטנה מעליו, כדי שיהיה ברור מה כל מספר
function numberField(value, label, step) {
  const field = document.createElement("label");
  field.className = "review-field";
  const title = document.createElement("span");
  title.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.step = step;
  input.inputMode = "decimal";
  input.value = typeof value === "number" ? value : "";
  field.append(title, input);
  return field;
}

// מקטינה את התמונה בעזרת canvas ומחזירה אותה כ-JPEG בפורמט data URL.
// תמונה מהטלפון יכולה לשקול 5MB ויותר, ואחרי ההקטנה היא בערך 150-300KB.
async function resizeImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    // decode מחכה שהתמונה תיטען, וזורק שגיאה אם הדפדפן לא מצליח לפתוח אותה
    await img.decode();

    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally {
    // משחררים את הזיכרון שהדפדפן הקצה לקובץ
    URL.revokeObjectURL(url);
  }
}

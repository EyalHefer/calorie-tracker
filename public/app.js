// =====================================================================
// מעקב קלוריות - שלב 1
// כל הנתונים נשמרים ב-localStorage של הדפדפן (אין שרת בשלב הזה).
//
// מבנה הנתונים שנשמר:
// {
//   "2026-10-08": { goal: 1800, items: [ { id: 1, name: "לחם", calories: 150 } ] },
//   "2026-10-09": { ... }
// }
// כל יום נשמר לפי התאריך שלו, ככה בכל יום חדש מתחילים מאפס ושומרים היסטוריה.
// =====================================================================

const STORAGE_KEY = "calorie-tracker-days";

// ---------- שכבת הנתונים: קריאה ושמירה ----------

// localStorage שומר רק מחרוזות, לכן ממירים את האובייקט ל-JSON ובחזרה.
function loadAllDays() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? JSON.parse(saved) : {};
}

function saveAllDays(days) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(days));
}

// מחזיר את התאריך של היום בפורמט YYYY-MM-DD לפי השעון המקומי.
// (toISOString משתמש בשעון UTC, ולכן אחרי חצות בישראל הוא היה מחזיר את אתמול)
function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getToday() {
  return loadAllDays()[todayKey()] || null;
}

function saveToday(today) {
  const days = loadAllDays();
  days[todayKey()] = today;
  saveAllDays(days);
}

// ---------- הפניות לאלמנטים ב-HTML ----------

const goalScreen = document.getElementById("goal-screen");
const mainScreen = document.getElementById("main-screen");
const goalForm = document.getElementById("goal-form");
const goalInput = document.getElementById("goal-input");
const foodForm = document.getElementById("food-form");
const foodNameInput = document.getElementById("food-name");
const foodCaloriesInput = document.getElementById("food-calories");
const foodSubmitButton = document.getElementById("food-submit");
const foodError = document.getElementById("food-error");
const foodList = document.getElementById("food-list");
const emptyMessage = document.getElementById("empty-message");

// ---------- ציור המסך (render) ----------
// העיקרון: הנתונים הם "מקור האמת". אחרי כל שינוי שומרים ואז מציירים מחדש
// את המסך לפי הנתונים, במקום לעדכן כל אלמנט ידנית בנפרד.

function render() {
  const today = getToday();

  // עוד לא הוגדר יעד להיום: מציגים את מסך היעד
  if (!today) {
    goalScreen.classList.remove("hidden");
    mainScreen.classList.add("hidden");
    return;
  }

  goalScreen.classList.add("hidden");
  mainScreen.classList.remove("hidden");

  // reduce עובר על כל הפריטים ומסכם את הקלוריות
  const eaten = today.items.reduce((sum, item) => sum + item.calories, 0);
  const remaining = today.goal - eaten;

  document.getElementById("eaten-number").textContent = eaten;
  document.getElementById("goal-number").textContent = today.goal;
  document.getElementById("remaining-number").textContent = Math.abs(remaining);
  document.getElementById("remaining-label").textContent =
    remaining >= 0 ? "קלוריות נשארו" : "קלוריות מעל היעד";

  const percent = Math.min((eaten / today.goal) * 100, 100);
  document.getElementById("progress-bar").style.width = percent + "%";
  document.querySelector(".summary").classList.toggle("over", remaining < 0);

  renderFoodList(today.items);
}

function renderFoodList(items) {
  foodList.innerHTML = "";
  emptyMessage.classList.toggle("hidden", items.length > 0);

  for (const item of items) {
    const li = document.createElement("li");

    // משתמשים ב-textContent ולא ב-innerHTML עבור טקסט שהמשתמש הקליד,
    // כדי שטקסט כמו <script> יוצג כטקסט רגיל ולא ירוץ כקוד.
    const name = document.createElement("span");
    name.className = "food-name";
    name.textContent = item.name;

    const calories = document.createElement("button");
    calories.className = "food-calories";
    calories.type = "button";
    calories.textContent = item.calories + " קק\"ל";
    calories.addEventListener("click", () => {
      const newCalories = prompt(`כמה קלוריות יש ב"${item.name}"?`, item.calories);
      if (newCalories !== null && Number(newCalories) >= 0) {
        updateItemCalories(item.id, Number(newCalories));
      }
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "✕";
    deleteButton.setAttribute("aria-label", "מחיקה");
    deleteButton.addEventListener("click", () => deleteItem(item.id));

    li.append(name, calories, deleteButton);
    foodList.append(li);
  }
}

// ---------- פעולות ----------

function setGoal(goal) {
  // אם כבר יש נתונים להיום (למשל כשמשנים יעד), שומרים על הפריטים הקיימים
  const today = getToday() || { goal: 0, items: [] };
  today.goal = goal;
  saveToday(today);
  render();
}

// מקבלת מערך של פריטים, כי ה-AI יכול להחזיר כמה פריטים מתיאור אחד
function addItems(newItems) {
  const today = getToday();
  for (const { name, calories } of newItems) {
    // crypto.randomUUID() יוצר מזהה ייחודי אקראי.
    // (קודם השתמשנו ב-Date.now(), אבל כשמוסיפים כמה פריטים באותה מילישנייה
    // הם היו מקבלים את אותו מזהה, ומחיקה של אחד הייתה מוחקת את כולם)
    today.items.push({ id: crypto.randomUUID(), name, calories });
  }
  saveToday(today);
  render();
}

function updateItemCalories(id, calories) {
  const today = getToday();
  const item = today.items.find((item) => item.id === id);
  item.calories = calories;
  saveToday(today);
  render();
}

// שולחת את התיאור לשרת שלנו (src/worker.js), שמעביר אותו ל-Gemini.
// async/await: הבקשה לוקחת זמן, ו-await "מחכה" לתשובה בלי לתקוע את הדף.
async function estimateCalories(text) {
  const response = await fetch("/api/estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "משהו השתבש");
  }
  return data.items;
}

function deleteItem(id) {
  const today = getToday();
  today.items = today.items.filter((item) => item.id !== id);
  saveToday(today);
  render();
}

function clearToday() {
  const today = getToday();
  today.items = [];
  saveToday(today);
  render();
}
// ---------- מאזיני אירועים ----------

goalForm.addEventListener("submit", (event) => {
  // ברירת המחדל של טופס היא לטעון את הדף מחדש, ואת זה אנחנו לא רוצים
  event.preventDefault();
  setGoal(Number(goalInput.value));
  goalInput.value = "";
});

foodForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = foodNameInput.value.trim();
  foodError.classList.add("hidden");

  // הוזנו קלוריות ידנית: מוסיפים ישר, בלי AI
  if (foodCaloriesInput.value !== "") {
    addItems([{ name, calories: Number(foodCaloriesInput.value) }]);
    foodForm.reset();
    return;
  }

  // אחרת: שואלים את ה-AI. בזמן ההמתנה מנטרלים את הכפתור כדי שלא ילחצו פעמיים.
  foodSubmitButton.disabled = true;
  foodSubmitButton.textContent = "מחשב...";
  try {
    const items = await estimateCalories(name);
    addItems(items);
    foodForm.reset();
  } catch (error) {
    foodError.textContent = error.message;
    foodError.classList.remove("hidden");
  } finally {
    // finally רץ תמיד, גם אם הצליח וגם אם נכשל
    foodSubmitButton.disabled = false;
    foodSubmitButton.textContent = "הוספה";
  }
});

document.getElementById("edit-goal").addEventListener("click", () => {
  const newGoal = prompt("מה היעד החדש להיום?", getToday().goal);
  if (newGoal && Number(newGoal) > 0) {
    setGoal(Number(newGoal));
  }
});
document.getElementById("clear-day").addEventListener("click", () => {
  clearToday();
});
// ---------- הפעלה ----------

document.getElementById("today-date").textContent = new Date().toLocaleDateString("he-IL", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

render();
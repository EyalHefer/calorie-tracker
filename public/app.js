// =====================================================================
// מעקב קלוריות
// כל הנתונים נשמרים ב-localStorage של הדפדפן.
//
// מבנה הנתונים שנשמר:
// {
//   "2026-10-08": {
//     goal: 1800, proteinGoal: 90,
//     items: [ { id: "...", name: "לחם", calories: 150, protein: 5 } ]
//   },
//   "2026-10-09": { ... }
// }
// כל יום נשמר לפי התאריך שלו, ככה בכל יום חדש מתחילים מאפס ושומרים היסטוריה.
//
// ימים ופריטים שנשמרו לפני שהוספנו חלבון: אין להם proteinGoal / protein.
// לא הופכים את זה ל-0, כי "לא ידוע" ו"אפס חלבון" זה לא אותו דבר.
//
// לפריט יכול להיות גם status:
//   "pending" - ה-AI עוד מחשב (נשמר, כדי שאם יוצאים מהאתר החישוב ימשיך כשחוזרים)
//   "failed"  - החישוב נכשל, ואפשר לנסות שוב
// =====================================================================

// import עובד כי app.js נטען כ-module (ראה index.html). זה אותו קובץ שהבדיקות בודקות.
import { suggestMeals } from "./suggest.js";

const STORAGE_KEY = "calorie-tracker-days";

// היום "מתחלף" ב-4 בבוקר ולא בחצות, כדי שמה שנאכל ב-1 בלילה ייספר ליום שעבר
const DAY_START_HOUR = 4;
const WEEK_LENGTH = 7;
// כמה ימים אחורה אפשר לדפדף
const HISTORY_DAYS = 30;

// ---------- שכבת הנתונים: קריאה ושמירה ----------

// localStorage שומר רק מחרוזות, לכן ממירים את האובייקט ל-JSON ובחזרה.
function loadAllDays() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? JSON.parse(saved) : {};
}

function saveAllDays(days) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(days));
}

function getDay(key) {
  return loadAllDays()[key] || null;
}

function saveDay(key, day) {
  const days = loadAllDays();
  days[key] = day;
  saveAllDays(days);
}

// ---------- תאריכים ----------

// ממיר תאריך למפתח בפורמט YYYY-MM-DD לפי השעון המקומי.
// (toISOString משתמש בשעון UTC, ולכן אחרי חצות בישראל הוא היה מחזיר את אתמול)
function formatKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function keyToDate(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// מזיזים את השעון 4 שעות אחורה ואז לוקחים את התאריך: ב-01:30 עדיין "אתמול"
function todayKey() {
  const shifted = new Date(Date.now() - DAY_START_HOUR * 60 * 60 * 1000);
  return formatKey(shifted);
}

function addDays(key, amount) {
  const date = keyToDate(key);
  // setDate מטפל לבד במעבר בין חודשים ושנים (למשל 31 + 1 = 1 בחודש הבא)
  date.setDate(date.getDate() + amount);
  return formatKey(date);
}

// היום שמוצג כרגע במסך. מתחיל בהיום, ומשתנה כשמדפדפים.
let selectedKey = todayKey();

// ---------- חישובים ----------

// reduce עובר על כל הפריטים ומסכם את הקלוריות (לפריט שעוד מחושב יש 0)
function totalCalories(day) {
  return day.items.reduce((sum, item) => sum + item.calories, 0);
}

// סכום החלבון של הפריטים שיש להם נתון. typeof בודק שהשדה קיים ושהוא מספר.
function totalProtein(day) {
  return day.items.reduce((sum, item) => sum + (typeof item.protein === "number" ? item.protein : 0), 0);
}

// פריט שהחישוב שלו הסתיים, אבל אין לו נתון חלבון (פריט ישן, או הזנה ידנית בלי חלבון)
function hasUnknownProtein(item) {
  return !item.status && typeof item.protein !== "number";
}

// עיגול לספרה אחת אחרי הנקודה, ובלי ".0" מיותר (12.0 → 12)
function formatGrams(grams) {
  return String(Math.round(grams * 10) / 10);
}

// היעד האחרון שהוגדר (לפי שם השדה: goal או proteinGoal), כדי למלא אותו מראש ולחסוך הקלדה
function lastGoal(field) {
  const days = loadAllDays();
  const keys = Object.keys(days).sort().reverse();
  const key = keys.find((key) => days[key][field]);
  return key ? days[key][field] : "";
}

// ---------- הפניות לאלמנטים ב-HTML ----------

const goalScreen = document.getElementById("goal-screen");
const mainScreen = document.getElementById("main-screen");
const goalForm = document.getElementById("goal-form");
const goalInput = document.getElementById("goal-input");
const proteinGoalInput = document.getElementById("protein-goal-input");
const foodForm = document.getElementById("food-form");
const foodNameInput = document.getElementById("food-name");
const foodCaloriesInput = document.getElementById("food-calories");
const foodProteinInput = document.getElementById("food-protein");
const foodList = document.getElementById("food-list");
const emptyMessage = document.getElementById("empty-message");
const weekCard = document.getElementById("week-card");
const weekChart = document.getElementById("week-chart");
const suggestCard = document.getElementById("suggest-card");
const suggestButton = document.getElementById("suggest-button");
const suggestMessage = document.getElementById("suggest-message");
const suggestList = document.getElementById("suggest-list");

// ---------- ציור המסך (render) ----------
// העיקרון: הנתונים הם "מקור האמת". אחרי כל שינוי שומרים ואז מציירים מחדש
// את המסך לפי הנתונים, במקום לעדכן כל אלמנט ידנית בנפרד.

function render() {
  const isToday = selectedKey === todayKey();
  renderDayNav(isToday);
  renderWeek();

  const day = getDay(selectedKey);

  // עוד לא הוגדר יעד ליום הזה: מציגים את מסך היעד
  if (!day) {
    document.getElementById("goal-title").textContent = isToday ? "בוקר טוב! ☀️" : "לא נרשם כלום ביום הזה";
    document.getElementById("goal-question").textContent = isToday
      ? "מה היעדים שלך להיום?"
      : "מה היו היעדים באותו יום?";
    goalInput.value = lastGoal("goal");
    proteinGoalInput.value = lastGoal("proteinGoal");
    goalScreen.classList.remove("hidden");
    mainScreen.classList.add("hidden");
    return;
  }

  goalScreen.classList.add("hidden");
  mainScreen.classList.remove("hidden");

  const eaten = totalCalories(day);
  const remaining = day.goal - eaten;

  document.getElementById("eaten-number").textContent = eaten;
  document.getElementById("goal-number").textContent = day.goal;
  document.getElementById("remaining-number").textContent = Math.abs(remaining);
  document.getElementById("remaining-label").textContent =
    remaining >= 0 ? "קלוריות נשארו" : "קלוריות מעל היעד";

  const percent = Math.min((eaten / day.goal) * 100, 100);
  document.getElementById("progress-bar").style.width = percent + "%";
  document.querySelector(".summary").classList.toggle("over", remaining < 0);

  renderProtein(day);
  renderSuggestions(day, remaining, isToday);

  document.getElementById("list-title").textContent = isToday ? "היום אכלת" : "ביום הזה אכלת";
  document.getElementById("clear-day").textContent = isToday ? "נקה את היום" : "נקה את היום הזה";
  renderFoodList(day.items);
}

function renderProtein(day) {
  const eaten = totalProtein(day);
  document.getElementById("protein-eaten").textContent = formatGrams(eaten);
  // יום ישן בלי יעד חלבון: מציגים "—" במקום מספר, ואפשר להגדיר עם "שינוי"
  document.getElementById("protein-goal").textContent = day.proteinGoal || "—";

  // בחלבון אין "חריגה" כמו בקלוריות (הרבה חלבון זה לא רע), אז הפס פשוט נעצר ב-100%
  const percent = day.proteinGoal ? Math.min((eaten / day.proteinGoal) * 100, 100) : 0;
  document.getElementById("protein-bar").style.width = percent + "%";

  document.getElementById("protein-unknown").classList.toggle("hidden", !day.items.some(hasUnknownProtein));
}

function renderDayNav(isToday) {
  document.getElementById("selected-date").textContent = keyToDate(selectedKey).toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  document.getElementById("next-day").disabled = isToday;
  document.getElementById("prev-day").disabled = selectedKey <= addDays(todayKey(), -HISTORY_DAYS);
  document.getElementById("back-to-today").classList.toggle("hidden", isToday);
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

    li.append(name, renderCalories(item));

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "✕";
    deleteButton.setAttribute("aria-label", "מחיקה");
    deleteButton.addEventListener("click", () => deleteItem(item.id));

    li.append(deleteButton);
    foodList.append(li);
  }
}

// החלק של הקלוריות נראה אחרת לפי מצב הפריט
function renderCalories(item) {
  if (item.status === "pending") {
    const span = document.createElement("span");
    span.className = "food-calories pending";
    span.textContent = "מחשב...";
    return span;
  }

  const button = document.createElement("button");
  button.type = "button";

  if (item.status === "failed") {
    button.className = "food-calories failed";
    button.textContent = "נכשל, לנסות שוב?";
    button.addEventListener("click", () => retryItem(item.id));
    return button;
  }

  button.className = "food-calories";
  const protein = typeof item.protein === "number" ? formatGrams(item.protein) : "?";
  button.textContent = `${item.calories} קק"ל · ${protein} ג' חלבון`;
  button.addEventListener("click", () => {
    const newCalories = prompt(`כמה קלוריות יש ב"${item.name}"?`, item.calories);
    // null = לחצו "ביטול": עוצרים בלי לשנות כלום
    if (newCalories === null || newCalories === "" || !(Number(newCalories) >= 0)) {
      return;
    }
    const newProtein = prompt(`וכמה גרם חלבון?`, typeof item.protein === "number" ? item.protein : "");
    // ביטול או שדה ריק בחלבון: משאירים את מה שהיה
    const protein = newProtein !== null && newProtein !== "" && Number(newProtein) >= 0 ? Number(newProtein) : item.protein;
    updateItem(item.id, Number(newCalories), protein);
  });
  return button;
}

// ---------- הצעות: מה עוד אפשר לאכול ----------

// מאגר המאכלים נטען מהשרת רק בפעם הראשונה שלוחצים על הכפתור, ואז נשמר כאן
let foodsCache = null;
// האם רשימת ההצעות פתוחה. כשהיא פתוחה, render מחשב אותה מחדש אחרי כל שינוי,
// כך שאם פריט "מחשב..." מסתיים, ההצעות מתעדכנות לבד.
let suggestionsOpen = false;

async function loadFoods() {
  if (!foodsCache) {
    const response = await fetch("/foods.json");
    if (!response.ok) {
      throw new Error("foods.json לא נטען");
    }
    foodsCache = await response.json();
  }
  return foodsCache;
}

function renderSuggestions(day, remaining, isToday) {
  // הצעות רק להיום (לא אוכלים אתמול), ורק כשבאמת נשארו קלוריות
  suggestCard.classList.toggle("hidden", !isToday || remaining <= 0);
  suggestButton.textContent = suggestionsOpen ? "הסתרת ההצעות" : "💡 מה עוד אפשר לאכול?";
  suggestList.innerHTML = "";
  suggestMessage.classList.add("hidden");

  if (!suggestionsOpen || !foodsCache) {
    return;
  }

  // יום ישן בלי יעד חלבון: מחשבים כאילו החלבון כבר הושלם, ואז רק הקלוריות קובעות
  const remainingProtein = day.proteinGoal ? day.proteinGoal - totalProtein(day) : 0;
  const suggestions = suggestMeals(remaining, remainingProtein, foodsCache);

  if (suggestions.length === 0) {
    showSuggestMessage(`לא מצאתי במאגר משהו שנכנס ב-${remaining} קלוריות`);
  } else if (day.items.some((item) => item.status === "pending")) {
    // לפריט שעוד מחושב יש 0 קלוריות, אז מה ש"נשאר" כרגע גדול מהאמת
    showSuggestMessage("יש פריטים שעוד מחושבים, אז ההצעות יתעדכנו בעוד רגע");
  }

  for (const suggestion of suggestions) {
    const li = document.createElement("li");

    const names = document.createElement("span");
    names.className = "suggest-names";
    names.textContent = suggestion.foods.map((food) => food.name).join(" + ");

    const totals = document.createElement("span");
    totals.className = "muted";
    totals.textContent = `${suggestion.calories} קק"ל · ${formatGrams(suggestion.protein)} ג' חלבון`;

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "link-button";
    addButton.textContent = "אכלתי את זה";
    addButton.addEventListener("click", () => addFoods(suggestion.foods));

    li.append(names, totals, addButton);
    suggestList.append(li);
  }
}

function showSuggestMessage(text) {
  suggestMessage.textContent = text;
  suggestMessage.classList.remove("hidden");
}

// ---------- הסיכום השבועי והגרף ----------

function renderWeek() {
  const today = todayKey();
  const days = loadAllDays();

  // 7 המפתחות האחרונים, מהישן לחדש. ב-RTL הראשון מוצג מימין, כמו שקוראים עברית.
  const keys = [];
  for (let i = WEEK_LENGTH - 1; i >= 0; i--) {
    keys.push(addDays(today, -i));
  }

  // לממוצע וליתרה סופרים רק ימים שהסתיימו ויש בהם נתונים, כי היום עוד לא נגמר
  const pastDays = keys.filter((key) => key !== today && days[key]).map((key) => days[key]);
  weekCard.classList.toggle("hidden", pastDays.length === 0);
  if (pastDays.length === 0) {
    return;
  }

  const totalEaten = pastDays.reduce((sum, day) => sum + totalCalories(day), 0);
  const balance = pastDays.reduce((sum, day) => sum + day.goal - totalCalories(day), 0);

  document.getElementById("stat-average").textContent = Math.round(totalEaten / pastDays.length).toLocaleString("he-IL");
  document.getElementById("stat-balance").textContent = Math.abs(balance).toLocaleString("he-IL");
  document.getElementById("stat-balance-label").textContent = balance >= 0 ? "נשארו מתחת ליעד" : "מעל היעד";
  // ממוצע חלבון רק מימים שבהם כבר עקבו אחרי חלבון (יש להם יעד), אחרת הממוצע יירד בגלל ימים ישנים
  const proteinDays = pastDays.filter((day) => day.proteinGoal);
  document.getElementById("stat-protein").textContent = proteinDays.length
    ? Math.round(proteinDays.reduce((sum, day) => sum + totalProtein(day), 0) / proteinDays.length) + " ג'"
    : "—";
  document.getElementById("stats-note").textContent =
    `לפי ${pastDays.length === 1 ? "יום אחד קודם" : pastDays.length + " ימים קודמים"} שנרשמו (בלי היום)`;

  renderChart(keys, days);
}

// גרף עמודות שבנוי מ-HTML ו-CSS רגילים: כל עמודה היא div שהגובה שלו באחוזים
function renderChart(keys, days) {
  // הסקאלה: הערך הכי גבוה בשבוע (אכילה או יעד) הוא 100% מגובה הגרף
  const maxValue = Math.max(
    1,
    ...keys.filter((key) => days[key]).map((key) => Math.max(totalCalories(days[key]), days[key].goal))
  );

  weekChart.innerHTML = "";
  for (const key of keys) {
    const day = days[key];
    const eaten = day ? totalCalories(day) : 0;
    const date = keyToDate(key);

    // כל יום הוא כפתור: לחיצה פותחת אותו. אזור הלחיצה הוא כל העמודה ולא רק הפס הדק.
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "bar-slot" + (key === selectedKey ? " selected" : "");
    slot.setAttribute(
      "aria-label",
      day ? `${date.toLocaleDateString("he-IL", { weekday: "long" })}: ${eaten} מתוך ${day.goal}` : "אין נתונים"
    );
    slot.addEventListener("click", () => selectDay(key));

    const area = document.createElement("div");
    area.className = "bar-area";

    if (day) {
      const bar = document.createElement("div");
      bar.className = "bar";
      bar.style.height = (eaten / maxValue) * 100 + "%";

      const goalMark = document.createElement("div");
      goalMark.className = "goal-mark";
      goalMark.style.bottom = (day.goal / maxValue) * 100 + "%";

      area.append(bar, goalMark);

      // מספר רק מעל היום שנבחר, ולא על כל עמודה, כדי שהגרף לא יהיה עמוס
      if (key === selectedKey) {
        const value = document.createElement("span");
        value.className = "bar-value";
        value.textContent = eaten;
        value.style.bottom = (Math.max(eaten, day.goal) / maxValue) * 100 + "%";
        area.append(value);
      }
    }

    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = date.toLocaleDateString("he-IL", { weekday: "narrow" });

    slot.append(area, label);
    weekChart.append(slot);
  }
}

// ---------- פעולות ----------

function selectDay(key) {
  selectedKey = key;
  suggestionsOpen = false;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// מקבלת אובייקט עם היעדים שמשתנים, למשל { goal: 1800 } או { goal: 1800, proteinGoal: 90 }
function setGoals(goals) {
  // אם כבר יש נתונים ליום (למשל כשמשנים יעד), שומרים על הפריטים הקיימים
  const day = getDay(selectedKey) || { goal: 0, items: [] };
  // Object.assign מעתיק את השדות מ-goals לתוך day, ומשאיר את השאר כמו שהם
  Object.assign(day, goals);
  saveDay(selectedKey, day);
  render();
}

// protein יכול להיות undefined (לא הוזן). JSON.stringify פשוט לא שומר שדה כזה.
function addItem(name, calories, protein) {
  const day = getDay(selectedKey);
  // crypto.randomUUID() יוצר מזהה ייחודי אקראי.
  // (קודם השתמשנו ב-Date.now(), אבל כשמוסיפים כמה פריטים באותה מילישנייה
  // הם היו מקבלים את אותו מזהה, ומחיקה של אחד הייתה מוחקת את כולם)
  day.items.push({ id: crypto.randomUUID(), name, calories, protein });
  saveDay(selectedKey, day);
  render();
}

// מוסיפה כמה מאכלים מהמאגר בבת אחת (מהצעה), ושומרת פעם אחת בסוף
function addFoods(foods) {
  const day = getDay(selectedKey);
  for (const food of foods) {
    day.items.push({ id: crypto.randomUUID(), name: food.name, calories: food.calories, protein: food.protein });
  }
  saveDay(selectedKey, day);
  suggestionsOpen = false;
  render();
}

// מוסיפה פריט "בהמתנה" מיד, ומפעילה את ה-AI ברקע בלי לחכות לו.
// ככה אפשר להמשיך להוסיף דברים, לדפדף, או אפילו לסגור את האתר.
function addItemWithAI(text) {
  const day = getDay(selectedKey);
  const item = { id: crypto.randomUUID(), name: text, calories: 0, status: "pending" };
  day.items.push(item);
  saveDay(selectedKey, day);
  render();

  // בלי await: הפונקציה ממשיכה לרוץ ברקע. שומרים את היום כבר עכשיו,
  // כדי שאם החישוב ייגמר אחרי 4 בבוקר, הפריט עדיין ייכנס ליום הנכון.
  resolveItem(selectedKey, item.id, text);
}

async function resolveItem(dayKey, id, text) {
  let result;
  try {
    result = await estimateCalories(text);
  } catch {
    result = null;
  }

  // קוראים את היום מחדש אחרי ה-await: בזמן ההמתנה יכלו לקרות שינויים
  // (פריטים נוספו, או שהפריט הזה נמחק)
  const day = getDay(dayKey);
  const index = day ? day.items.findIndex((item) => item.id === id) : -1;
  if (index === -1) {
    return;
  }

  if (result && result.length > 0) {
    // מחליפים את הפריט הממתין בפריטים שה-AI החזיר, באותו מקום ברשימה
    const newItems = result.map(({ name, calories, protein }) => ({ id: crypto.randomUUID(), name, calories, protein }));
    day.items.splice(index, 1, ...newItems);
  } else {
    day.items[index].status = "failed";
  }
  saveDay(dayKey, day);
  render();
}

function retryItem(id) {
  const day = getDay(selectedKey);
  const item = day.items.find((item) => item.id === id);
  item.status = "pending";
  saveDay(selectedKey, day);
  render();
  resolveItem(selectedKey, id, item.name);
}

// כשנכנסים לאתר: פריטים שנשארו "בהמתנה" (כי יצאו באמצע החישוב) נשלחים שוב
function resumePendingItems() {
  const days = loadAllDays();
  for (const [key, day] of Object.entries(days)) {
    for (const item of day.items) {
      if (item.status === "pending") {
        resolveItem(key, item.id, item.name);
      }
    }
  }
}

function updateItem(id, calories, protein) {
  const day = getDay(selectedKey);
  const item = day.items.find((item) => item.id === id);
  item.calories = calories;
  item.protein = protein;
  saveDay(selectedKey, day);
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
  const day = getDay(selectedKey);
  day.items = day.items.filter((item) => item.id !== id);
  saveDay(selectedKey, day);
  render();
}

function clearDay() {
  const day = getDay(selectedKey);
  day.items = [];
  saveDay(selectedKey, day);
  render();
}

// ---------- מאזיני אירועים ----------

goalForm.addEventListener("submit", (event) => {
  // ברירת המחדל של טופס היא לטעון את הדף מחדש, ואת זה אנחנו לא רוצים
  event.preventDefault();
  setGoals({ goal: Number(goalInput.value), proteinGoal: Number(proteinGoalInput.value) });
  goalForm.reset();
});

foodForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = foodNameInput.value.trim();

  // הוזנו קלוריות ידנית: מוסיפים ישר (חלבון לא חובה). אחרת: ה-AI מחשב ברקע.
  if (foodCaloriesInput.value !== "") {
    const protein = foodProteinInput.value !== "" ? Number(foodProteinInput.value) : undefined;
    addItem(name, Number(foodCaloriesInput.value), protein);
  } else {
    addItemWithAI(name);
  }
  foodForm.reset();
  foodNameInput.focus();
});

document.getElementById("edit-goal").addEventListener("click", () => {
  const newGoal = prompt("מה יעד הקלוריות החדש ליום הזה?", getDay(selectedKey).goal);
  if (newGoal && Number(newGoal) > 0) {
    setGoals({ goal: Number(newGoal) });
  }
});

document.getElementById("edit-protein-goal").addEventListener("click", () => {
  const day = getDay(selectedKey);
  const newGoal = prompt("מה יעד החלבון (בגרמים) ליום הזה?", day.proteinGoal || lastGoal("proteinGoal"));
  if (newGoal && Number(newGoal) > 0) {
    setGoals({ proteinGoal: Number(newGoal) });
  }
});

document.getElementById("clear-day").addEventListener("click", () => {
  clearDay();
});

suggestButton.addEventListener("click", async () => {
  if (suggestionsOpen) {
    suggestionsOpen = false;
    render();
    return;
  }
  try {
    await loadFoods();
  } catch {
    showSuggestMessage("לא הצלחתי לטעון את מאגר המאכלים");
    return;
  }
  suggestionsOpen = true;
  render();
});

document.getElementById("prev-day").addEventListener("click", () => selectDay(addDays(selectedKey, -1)));
document.getElementById("next-day").addEventListener("click", () => selectDay(addDays(selectedKey, 1)));
document.getElementById("back-to-today").addEventListener("click", () => selectDay(todayKey()));

// ---------- הפעלה ----------

render();
resumePendingItems();

// כשהאינטרנט חוזר, מנסים שוב את מה שנכשל (למשל פריט שהוזן בלי קליטה)
window.addEventListener("online", () => {
  for (const [key, day] of Object.entries(loadAllDays())) {
    for (const item of day.items) {
      if (item.status === "failed") {
        item.status = "pending";
        saveDay(key, day);
        resolveItem(key, item.id, item.name);
      }
    }
  }
  render();
});

// רישום ה-Service Worker (public/sw.js). דפדפנים ישנים בלי תמיכה פשוט ידלגו.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}

// בדיקות לפונקציית ההצעות. להרצה: npm test
// node:test היא ספריית הבדיקות שמובנית ב-Node, אין צורך להתקין כלום.
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestMeals } from "../public/suggest.js";

// מאגר קבוע לבדיקות (לא foods.json), כדי ששינויים במאגר האמיתי לא ישברו את הבדיקות
const FOODS = [
  { name: "שקשוקה", type: "meal", calories: 300, protein: 18 },
  { name: "חזה עוף", type: "meal", calories: 250, protein: 40 },
  { name: "ספרינג רולס", type: "meal", calories: 350, protein: 12 },
  { name: "פיתה", type: "side", calories: 180, protein: 6 },
  { name: "סלט", type: "side", calories: 130, protein: 2 },
  { name: "חצי אבוקדו", type: "side", calories: 120, protein: 1.5 },
  { name: "תפוח", type: "snack", calories: 80, protein: 0.5 },
  { name: "פריכיות", type: "snack", calories: 70, protein: 2 },
  { name: "חטיף אצות", type: "snack", calories: 30, protein: 1 },
  { name: "יוגורט חלבון", type: "snack", calories: 120, protein: 20 },
];
const CHEAPEST_MEAL = 250;
const MANY = { count: 10000 };

// "מפתח" להצעה שלא תלוי בסדר: ממיינים את השמות ומחברים
const comboKey = (combo) => combo.foods.map((food) => food.name).sort().join("+");
const countType = (combo, type) => combo.foods.filter((food) => food.type === type).length;

test("מחזירה מערך ריק כששום דבר לא נכנס", () => {
  assert.deepEqual(suggestMeals(20, 20, FOODS), []);
});

test("מחזירה הצעות כשיש מקום", () => {
  assert.ok(suggestMeals(600, 30, FOODS).length > 0, "נשארו 600 קלוריות, אמורות להיות הצעות");
});

test("אף הצעה לא עוברת את הקלוריות שנשארו", () => {
  for (const budget of [50, 150, 300, 450, 600, 900]) {
    for (const combo of suggestMeals(budget, 30, FOODS, MANY)) {
      assert.ok(combo.calories <= budget, `${comboKey(combo)} = ${combo.calories} קלוריות, יותר מ-${budget}`);
    }
  }
});

test("הסכומים calories ו-protein נכונים", () => {
  for (const combo of suggestMeals(900, 40, FOODS, MANY)) {
    const calories = combo.foods.reduce((sum, food) => sum + food.calories, 0);
    const protein = combo.foods.reduce((sum, food) => sum + food.protein, 0);
    assert.equal(combo.calories, calories, `סכום קלוריות שגוי ב-${comboKey(combo)}`);
    assert.equal(combo.protein, protein, `סכום חלבון שגוי ב-${comboKey(combo)}`);
  }
});

test("אותו מאכל לא מופיע פעמיים בהצעה", () => {
  for (const combo of suggestMeals(900, 60, FOODS, MANY)) {
    const names = combo.foods.map((food) => food.name);
    assert.equal(new Set(names).size, names.length, `מאכל כפול ב-${names.join("+")}`);
  }
});

test("אותה הצעה לא חוזרת בסדר אחר", () => {
  const keys = suggestMeals(900, 60, FOODS, MANY).map(comboKey);
  assert.equal(new Set(keys).size, keys.length, "יש הצעה שמופיעה יותר מפעם אחת");
});

test("כשארוחה נכנסת: ארוחה אחת, עד תוספת אחת, עד 2 נשנושים", () => {
  const results = suggestMeals(900, 40, FOODS, MANY);
  assert.ok(results.length > 0);
  for (const combo of results) {
    assert.equal(countType(combo, "meal"), 1, `${comboKey(combo)}: צריכה להיות בדיוק ארוחה אחת`);
    assert.ok(countType(combo, "side") <= 1, `${comboKey(combo)}: יותר מתוספת אחת`);
    assert.ok(countType(combo, "snack") <= 2, `${comboKey(combo)}: יותר מ-2 נשנושים`);
  }
});

test("מייצרת את כל ההצעות האפשריות (לא מפספסת צירופים)", () => {
  // בודקים שני קצוות: הצעה מלאה (ארוחה + תוספת + 2 נשנושים) והצעה של ארוחה לבד
  const keys = suggestMeals(900, 40, FOODS, MANY).map(comboKey);
  const expected = ["שקשוקה", "פיתה", "תפוח", "פריכיות"].sort().join("+"); // 630 קלוריות
  assert.ok(keys.includes(expected), `חסרה ההצעה ${expected}`);
  assert.ok(keys.includes("חזה עוף"), "חסרה ההצעה של ארוחה לבד");
});

test("מכבדת את maxSnacks ואת count", () => {
  const results = suggestMeals(900, 40, FOODS, { maxSnacks: 1, count: 5 });
  assert.ok(results.length <= 5, `ביקשנו 5 הצעות לכל היותר, קיבלנו ${results.length}`);
  for (const combo of suggestMeals(900, 40, FOODS, { maxSnacks: 1, count: 10000 })) {
    assert.ok(countType(combo, "snack") <= 1, `${comboKey(combo)}: ביקשנו נשנוש אחד לכל היותר`);
  }
});

test("כשאין מקום לארוחה: מציעה רק נשנושים", () => {
  const budget = CHEAPEST_MEAL - 1;
  const results = suggestMeals(budget, 20, FOODS, MANY);
  assert.ok(results.length > 0, `נשארו ${budget} קלוריות, אמורות להיות הצעות של נשנושים`);
  for (const combo of results) {
    assert.equal(combo.foods.length, countType(combo, "snack"), `${comboKey(combo)}: אמורים להיות רק נשנושים`);
    assert.ok(combo.foods.length >= 1 && combo.foods.length <= 2, `${comboKey(combo)}: בין 1 ל-2 נשנושים`);
  }
});

test("מעדיפה הצעה שמקרבת ליעד החלבון", () => {
  // נשארו 300 קלוריות ו-40 גרם חלבון: חזה עוף (40 גרם) עדיף בהרבה על שקשוקה או ספרינג רולס
  const [best] = suggestMeals(300, 40, FOODS);
  assert.ok(best.foods.some((food) => food.name === "חזה עוף"), `ההצעה הראשונה היא ${comboKey(best)}`);
});

test("לא מציעה ארוחה זעומה כשיש הרבה קלוריות פנויות", () => {
  const [best] = suggestMeals(600, 20, FOODS);
  assert.ok(best.calories >= 400, `ההצעה הראשונה היא ${comboKey(best)} עם ${best.calories} קלוריות בלבד`);
});

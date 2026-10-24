// בדיקות לפונקציית ההצעות. להרצה: npm test
// node:test היא ספריית הבדיקות שמובנית ב-Node, אין צורך להתקין כלום.
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestMeals } from "../public/suggest.js";

const FOODS = [
  { name: "חביתה", calories: 180, protein: 12 },
  { name: "סלט", calories: 130, protein: 2 },
  { name: "חזה עוף", calories: 250, protein: 40 },
  { name: "אורז", calories: 200, protein: 4 },
  { name: "קוטג'", calories: 90, protein: 11 },
  { name: "פרוסת לחם", calories: 80, protein: 3 },
  { name: "טונה", calories: 120, protein: 25 },
];

// "מפתח" לצירוף שלא תלוי בסדר: ממיינים את השמות ומחברים
const comboKey = (combo) => combo.foods.map((food) => food.name).sort().join("+");

test("מחזירה מערך ריק כששום דבר לא נכנס", () => {
  assert.deepEqual(suggestMeals(50, 20, FOODS), []);
});

test("מחזירה הצעות כשיש מקום", () => {
  assert.ok(suggestMeals(400, 30, FOODS).length > 0, "נשארו 400 קלוריות, אמורות להיות הצעות");
});

test("אף צירוף לא עובר את הקלוריות שנשארו", () => {
  for (const budget of [100, 250, 400, 600, 900]) {
    for (const combo of suggestMeals(budget, 30, FOODS, { count: 100 })) {
      assert.ok(combo.calories <= budget, `${comboKey(combo)} = ${combo.calories} קלוריות, יותר מ-${budget}`);
    }
  }
});

test("הסכומים calories ו-protein נכונים", () => {
  for (const combo of suggestMeals(600, 40, FOODS, { count: 100 })) {
    const calories = combo.foods.reduce((sum, food) => sum + food.calories, 0);
    const protein = combo.foods.reduce((sum, food) => sum + food.protein, 0);
    assert.equal(combo.calories, calories, `סכום קלוריות שגוי ב-${comboKey(combo)}`);
    assert.equal(combo.protein, protein, `סכום חלבון שגוי ב-${comboKey(combo)}`);
  }
});

test("אותו מאכל לא מופיע פעמיים בצירוף", () => {
  for (const combo of suggestMeals(900, 60, FOODS, { count: 100 })) {
    const names = combo.foods.map((food) => food.name);
    assert.equal(new Set(names).size, names.length, `מאכל כפול ב-${names.join("+")}`);
  }
});

test("אותו צירוף לא חוזר בסדר אחר", () => {
  const keys = suggestMeals(900, 60, FOODS, { count: 100 }).map(comboKey);
  assert.equal(new Set(keys).size, keys.length, "יש צירוף שמופיע יותר מפעם אחת");
});

test("מכבדת את maxItems ואת count", () => {
  const results = suggestMeals(900, 60, FOODS, { maxItems: 2, count: 5 });
  assert.ok(results.length <= 5, `ביקשנו 5 הצעות לכל היותר, קיבלנו ${results.length}`);
  for (const combo of results) {
    assert.ok(combo.foods.length >= 1 && combo.foods.length <= 2, `${comboKey(combo)}: יותר מ-2 מאכלים`);
  }
});

test("מעדיפה צירוף שמקרב ליעד החלבון", () => {
  // נשארו 30 גרם חלבון: טונה (25 גרם) עדיפה בהרבה על אורז (4 גרם) באותו טווח קלוריות
  const [best] = suggestMeals(250, 30, FOODS);
  assert.ok(
    best.foods.some((food) => food.name === "טונה" || food.name === "חזה עוף"),
    `ההצעה הראשונה היא ${comboKey(best)}, ואין בה מקור חלבון טוב`
  );
});

test("לא מציעה ארוחה זעומה כשיש הרבה קלוריות פנויות", () => {
  // נשארו 450 קלוריות: ההצעה הראשונה לא אמורה להיות קוטג' לבד (90 קלוריות)
  const [best] = suggestMeals(450, 30, FOODS);
  assert.ok(best.calories >= 250, `ההצעה הראשונה היא ${comboKey(best)} עם ${best.calories} קלוריות בלבד`);
});

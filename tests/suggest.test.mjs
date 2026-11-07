// בדיקות לפונקציית ההצעות. להרצה: npm test
// node:test היא ספריית הבדיקות שמובנית ב-Node, אין צורך להתקין כלום.
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggest, PORTION } from "../public/suggest.js";

// מאגר קבוע לבדיקות (לא foods.json), כדי ששינויים במאגר האמיתי לא ישברו את הבדיקות
const FOODS = [
  { name: "שקשוקה", type: "meal", calories: 300, protein: 18 },
  { name: "חזה עוף", type: "meal", calories: 250, protein: 40 },
  { name: "ספרינג רולס", type: "meal", calories: 350, protein: 12 },
  { name: "פסטה גדולה", type: "meal", calories: 900, protein: 25 },
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

const comboKey = (combo) => combo.foods.map((food) => food.name).join("+");
const countType = (combo, type) => combo.foods.filter((food) => food.type === type).length;

test("מחזירה מערך ריק כששום דבר לא נכנס", () => {
  assert.deepEqual(suggest("meal", 20, 20, FOODS), []);
  assert.deepEqual(suggest("snack", 20, 20, FOODS), []);
});

test("זורקת שגיאה על סוג לא מוכר", () => {
  assert.throws(() => suggest("dessert", 500, 20, FOODS));
});

test("אף הצעה לא עוברת את הקלוריות שנשארו", () => {
  for (const kind of ["meal", "snack"]) {
    for (const budget of [50, 150, 300, 450, 600, 1500]) {
      for (const combo of suggest(kind, budget, 30, FOODS, MANY)) {
        assert.ok(combo.calories <= budget, `${comboKey(combo)} = ${combo.calories} קלוריות, יותר מ-${budget}`);
      }
    }
  }
});

test("הסכומים calories ו-protein נכונים", () => {
  for (const kind of ["meal", "snack"]) {
    for (const combo of suggest(kind, 1500, 40, FOODS, MANY)) {
      const calories = combo.foods.reduce((sum, food) => sum + food.calories, 0);
      const protein = combo.foods.reduce((sum, food) => sum + food.protein, 0);
      assert.equal(combo.calories, calories, `סכום קלוריות שגוי ב-${comboKey(combo)}`);
      assert.equal(combo.protein, protein, `סכום חלבון שגוי ב-${comboKey(combo)}`);
    }
  }
});

test("ארוחה: ארוחה אחת, עד תוספת אחת, בלי נשנושים", () => {
  const results = suggest("meal", 1500, 40, FOODS, MANY);
  assert.ok(results.length > 0);
  for (const combo of results) {
    assert.equal(countType(combo, "meal"), 1, `${comboKey(combo)}: צריכה להיות בדיוק ארוחה אחת`);
    assert.ok(countType(combo, "side") <= 1, `${comboKey(combo)}: יותר מתוספת אחת`);
    assert.equal(countType(combo, "snack"), 0, `${comboKey(combo)}: נשנוש בתוך הצעת ארוחה`);
  }
});

test("נשנוש: נשנוש אחד בלבד", () => {
  const results = suggest("snack", 1500, 40, FOODS, MANY);
  assert.equal(results.length, 4, "כל ארבעת הנשנושים נכנסים");
  for (const combo of results) {
    assert.equal(combo.foods.length, 1, `${comboKey(combo)}: יותר ממאכל אחד`);
    assert.equal(countType(combo, "snack"), 1, `${comboKey(combo)}: זה לא נשנוש`);
  }
});

test("כל ארוחה מופיעה רק פעם אחת בהצעות", () => {
  const mains = suggest("meal", 1500, 40, FOODS, MANY).map((combo) => combo.foods[0].name);
  assert.equal(new Set(mains).size, mains.length, `ארוחה חוזרת: ${mains.join(", ")}`);
  assert.equal(mains.length, 4, "כל ארבע הארוחות נכנסות ב-1500");
});

test("ארוחה כשאין מקום לארוחה: מערך ריק, בלי ליפול לנשנושים", () => {
  assert.deepEqual(suggest("meal", CHEAPEST_MEAL - 1, 20, FOODS), []);
});

test("מכבדת את count", () => {
  assert.ok(suggest("meal", 1500, 40, FOODS, { count: 2 }).length <= 2);
  assert.ok(suggest("snack", 1500, 40, FOODS, { count: 2 }).length <= 2);
});

test("מעדיפה ארוחה שמקרבת ליעד החלבון", () => {
  const [best] = suggest("meal", 500, 40, FOODS);
  assert.equal(best.foods[0].name, "חזה עוף", `ההצעה הראשונה היא ${comboKey(best)}`);
});

test("מעדיפה נשנוש שמקרב ליעד החלבון", () => {
  const [best] = suggest("snack", 500, 30, FOODS);
  assert.equal(comboKey(best), "יוגורט חלבון");
});

test("לא סוגרת את כל היום: ארוחה בגודל רגיל גם כשנשארו הרבה קלוריות", () => {
  // נשארו 1500: הפסטה של 900 נכנסת, אבל היא תשאיר מעט מדי לשאר היום
  for (const protein of [0, 30]) {
    const [best] = suggest("meal", 1500, protein, FOODS);
    assert.ok(best.calories <= PORTION.meal.max, `ההצעה הראשונה היא ${comboKey(best)} עם ${best.calories} קלוריות`);
  }
});

test("לא מציעה ארוחה זעומה כשיש מקום", () => {
  // החלבון כבר הושלם, אז רק גודל המנה קובע: חזה עוף לבד (250) קטן מדי לארוחת ערב
  const [best] = suggest("meal", 1000, 0, FOODS);
  assert.ok(best.calories >= PORTION.meal.min, `ההצעה הראשונה היא ${comboKey(best)} עם ${best.calories} קלוריות בלבד`);
});

test("כשנשאר מעט, ארוחה שמנצלת את מה שנשאר לא נענשת", () => {
  // נשארו 300: שקשוקה (300) מתאימה בדיוק, וחזה עוף (250) עדיף בגלל החלבון
  const results = suggest("meal", 300, 0, FOODS, MANY);
  assert.deepEqual(results.map((combo) => combo.foods[0].name).sort(), ["חזה עוף", "שקשוקה"].sort());
});

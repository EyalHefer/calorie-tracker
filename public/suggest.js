// הצעות: "מה לאכול עכשיו"
// =====================================================================
// המשתמשת בוחרת מה בא לה עכשיו: ארוחה או נשנוש, ומקבלת הצעות רק מהסוג הזה.
// המטרה היא לא "לסגור את היום": אם נשארו 1,200 קלוריות והיא רוצה ארוחת ערב,
// מציעים ארוחת ערב בגודל רגיל, וכך נשאר לה מקום לנשנש אחר כך מול הטלוויזיה.
//
// מבנה של הצעה:
//   "meal"  - ארוחה אחת בדיוק, ועוד 0 או 1 תוספת.
//   "snack" - נשנוש אחד.
//
// הכללים (הבדיקות ב-tests/suggest.test.mjs בודקות אותם):
//   1. סכום הקלוריות של הצעה לא עובר את remainingCalories.
//   2. ההצעה בנויה לפי המבנה שלמעלה (אין "נפילה" לנשנושים כשאין מקום לארוחה:
//      במקרה כזה מחזירים מערך ריק, והמסך מציע לנסות נשנוש).
//   3. בהצעות ארוחה, כל ארוחה מופיעה רק פעם אחת (עם התוספת הכי מתאימה לה),
//      כדי ששלוש ההצעות לא יהיו "סושי + טונה", "סושי + קוטג'", "סושי לבד".
//   4. מחזירים לכל היותר count הצעות, מהטובה לפחות טובה.
//   5. אם שום דבר לא נכנס, מחזירים מערך ריק.
//
// להרצת הבדיקות: npm test
// =====================================================================

/**
 * @typedef {{name: string, type: "meal" | "side" | "snack", calories: number, protein: number}} Food
 * @typedef {{foods: Food[], calories: number, protein: number}} Suggestion
 */

// גודל מנה "סביר" לכל סוג, בקלוריות. הצעה בתוך הטווח לא נענשת, ומחוצה לו נענשת
// לפי המרחק. ככה ארוחה לא בולעת את כל מה שנשאר, ונשנוש לא הופך לארוחה.
export const PORTION = {
  meal: { min: 350, max: 650 },
  snack: { min: 80, max: 200 },
};

// כמה נקודות שווה גרם חלבון שמקרב ליעד, לעומת נקודה אחת לכל קלוריה מחוץ לטווח
const PROTEIN_WEIGHT = 10;

/**
 * @param {"meal" | "snack"} kind מה בא לה עכשיו
 * @param {number} remainingCalories כמה קלוריות נשארו עד היעד
 * @param {number} remainingProtein כמה גרם חלבון נשארו עד היעד (0 או שלילי אם כבר הגיעה)
 * @param {Food[]} foods מאגר המאכלים
 * @param {{count?: number}} [options]
 * @returns {Suggestion[]} ההצעות הכי טובות
 */
export function suggest(kind, remainingCalories, remainingProtein, foods, { count = 3 } = {}) {
  if (!PORTION[kind]) {
    throw new Error(`סוג הצעה לא מוכר: ${kind}`);
  }

  // שלב 1: כל ההצעות האפשריות מהסוג שביקשה
  let combos;
  if (kind === "meal") {
    const meals = foods.filter((food) => food.type === "meal");
    // null מייצג "בלי תוספת"
    const sideOptions = [null, ...foods.filter((food) => food.type === "side")];
    combos = [];
    for (const meal of meals) {
      for (const side of sideOptions) {
        combos.push(makeCombo(side ? [meal, side] : [meal]));
      }
    }
  } else {
    combos = foods.filter((food) => food.type === "snack").map((snack) => makeCombo([snack]));
  }

  // שלב 2: רק מה שנכנס בקלוריות שנשארו
  combos = combos.filter((combo) => combo.calories <= remainingCalories);

  // שלב 3: מיון מהציון הגבוה לנמוך
  const portion = PORTION[kind];
  const scored = combos.map((combo) => ({ combo, score: score(combo, portion, remainingCalories, remainingProtein) }));
  scored.sort((a, b) => b.score - a.score);

  // שלב 4: כל ארוחה (המאכל הראשון בהצעה) פעם אחת בלבד, ולוקחים את count הראשונות.
  // כי המערך כבר ממוין, הפעם הראשונה שארוחה מופיעה היא הגרסה הכי טובה שלה.
  const seen = new Set();
  const results = [];
  for (const { combo } of scored) {
    const main = combo.foods[0].name;
    if (seen.has(main)) {
      continue;
    }
    seen.add(main);
    results.push(combo);
    if (results.length === count) {
      break;
    }
  }
  return results;
}

// הופכת רשימת מאכלים להצעה עם הסכומים
function makeCombo(items) {
  return {
    foods: items,
    calories: items.reduce((sum, food) => sum + food.calories, 0),
    protein: items.reduce((sum, food) => sum + food.protein, 0),
  };
}

// ציון גבוה = הצעה טובה יותר
function score(combo, portion, remainingCalories, remainingProtein) {
  let finalScore = 0;

  // 1. השלמת יעד החלבון (הכי חשוב). רק החלבון שעוד חסר נחשב:
  //    אם חסרים 20 גרם, מנה עם 40 גרם לא שווה פי 2 ממנה עם 20.
  if (remainingProtein > 0) {
    finalScore += Math.min(combo.protein, remainingProtein) * PROTEIN_WEIGHT;
  }

  // 2. גודל מנה סביר. התקרה היא הטווח הרגיל או מה שנשאר, הנמוך מביניהם:
  //    אם נשארו רק 400, ארוחה של 400 היא "בדיוק בגודל" ולא נענשת.
  const max = Math.min(portion.max, remainingCalories);
  const min = Math.min(portion.min, max);
  if (combo.calories < min) {
    finalScore -= min - combo.calories;
  } else if (combo.calories > max) {
    finalScore -= combo.calories - max;
  }

  // 3. שובר שוויון קטן: צפיפות חלבון (גרם חלבון ל-100 קלוריות).
  //    חשוב בעיקר כשהיא כבר הגיעה ליעד החלבון ורוב ההצעות בטווח.
  finalScore += (combo.protein / Math.max(combo.calories, 1)) * 100;

  return finalScore;
}

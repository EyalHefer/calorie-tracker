
// מבנה של הצעה:
//   - ארוחה אחת בדיוק
//   - ועוד 0 או 1 תוספת
//   - ועוד 0 עד maxSnacks נשנושים (שונים זה מזה)
//   ואם אף ארוחה לא נכנסת בקלוריות שנשארו: מציעים רק נשנושים (1 עד maxSnacks).
//
// הכללים (הבדיקות ב-tests/suggest.test.mjs בודקות אותם):
//   1. סכום הקלוריות של הצעה לא עובר את remainingCalories.
//   2. כל מאכל מופיע לכל היותר פעם אחת בהצעה.
//   3. ההצעה בנויה לפי המבנה שלמעלה.
//   4. אותה הצעה לא מופיעה פעמיים בסדר אחר ("תפוח + פריכיות" = "פריכיות + תפוח").
//   5. מחזירים לכל היותר count הצעות, מהטובה לפחות טובה.
//   6. אם שום דבר לא נכנס, מחזירים מערך ריק.
//
// מה זו הצעה "טובה"? זו ההחלטה שלך: אתה מגדיר פונקציית ציון (score).
// כמה דברים לחשוב עליהם:
//   - כמה ההצעה מקרבת אותה ליעד החלבון? (זה כנראה הכי חשוב)
//   - האם היא מנצלת את הקלוריות שנשארו? ארוחה של 150 קלוריות כשנשארו 600 לא תשביע אותה.
//   - מה קורה כשהיא כבר הגיעה ליעד החלבון (remainingProtein <= 0)?
//
// רמז לסדר העבודה:
//   שלב 1: לחלק את המאגר לשלוש רשימות לפי type (filter).
//   שלב 2: לייצר את כל ההצעות האפשריות: לולאה על הארוחות, ובתוכה על התוספות
//          (כולל "בלי תוספת"), ובתוכה על הנשנושים (כולל "בלי נשנוש").
//          איך מוודאים שזוג נשנושים לא מופיע פעמיים בסדר הפוך?
//   שלב 3: לסנן את מה שעובר את הקלוריות.
//   שלב 4: אם לא נשאר כלום, לייצר הצעות של נשנושים בלבד.
//   שלב 5: לחשב ציון לכל הצעה, למיין, ולהחזיר את count הראשונות.
//
// להרצת הבדיקות: npm test
// =====================================================================

/**
 * @typedef {{name: string, type: "meal" | "side" | "snack", calories: number, protein: number}} Food
 */

/**
 * @param {number} remainingCalories כמה קלוריות נשארו עד היעד
 * @param {number} remainingProtein כמה גרם חלבון נשארו עד היעד (0 או שלילי אם כבר הגיעה)
 * @param {Food[]} foods מאגר המאכלים
 * @param {{maxSnacks?: number, count?: number}} [options]
 * @returns {Array<{foods: Food[], calories: number, protein: number}>}
 *   ההצעות הכי טובות. foods הם המאכלים בהצעה, calories ו-protein הם הסכומים שלהם.
 */
export function suggestMeals(remainingCalories, remainingProtein, foods, { maxSnacks = 2, count = 3 } = {}) {
  // שלב 1: חלוקה לפי type
  const meals = foods.filter((food) => food.type === "meal");
  const sides = foods.filter((food) => food.type === "side");
  const snacks = foods.filter((food) => food.type === "snack");

  // שלב 2: כל הצירופים האפשריים.
  // null ברשימת התוספות מייצג "בלי תוספת", ו-[] ברשימת הנשנושים מייצג "בלי נשנוש",
  // ככה שלוש לולאות פשוטות מכסות גם את המקרים שבהם חסר חלק.
  const sideOptions = [null, ...sides];
  const snackOptions = snackGroups(snacks, maxSnacks);

  let combos = [];
  for (const meal of meals) {
    for (const side of sideOptions) {
      for (const group of snackOptions) {
        const items = side ? [meal, side, ...group] : [meal, ...group];
        combos.push(makeCombo(items));
      }
    }
  }

  // שלב 3: רק מה שנכנס בקלוריות שנשארו
  combos = combos.filter((combo) => combo.calories <= remainingCalories);

  // שלב 4: אף ארוחה לא נכנסה, אז רק נשנושים (בלי הקבוצה הריקה)
  if (combos.length === 0) {
    combos = snackOptions
      .filter((group) => group.length > 0)
      .map(makeCombo)
      .filter((combo) => combo.calories <= remainingCalories);
  }

  // שלב 5: מיון מהציון הגבוה לנמוך, ולוקחים את count הראשונות
  combos.sort((a, b) => score(b, remainingCalories, remainingProtein) - score(a, remainingCalories, remainingProtein));
  return combos.slice(0, count);
}

// כל קבוצות הנשנושים בגודל 0 עד maxSnacks (עד 2).
// j מתחיל מ-i + 1, ולכן כל זוג נוצר פעם אחת בלבד: [תפוח, פריכיות] כן, [פריכיות, תפוח] לא.
function snackGroups(snacks, maxSnacks) {
  const groups = [[]];
  if (maxSnacks >= 1) {
    for (const snack of snacks) {
      groups.push([snack]);
    }
  }
  if (maxSnacks >= 2) {
    for (let i = 0; i < snacks.length; i++) {
      for (let j = i + 1; j < snacks.length; j++) {
        groups.push([snacks[i], snacks[j]]);
      }
    }
  }
  return groups;
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
function score(combo, remainingCalories, remainingProtein) {
  let finalScore = 0;

  // 1. השלמת יעד החלבון (הכי חשוב) - משקל גבוה לכל גרם שסוגר את הפער
  if (remainingProtein > 0) {
    const usefulProtein = Math.min(combo.protein, remainingProtein);
    finalScore += usefulProtein * 50; 
  }

  // 2. ניצול קלוריות - כדי שהיא באמת תשבע ולא תקבל מנה של 150 כשיש לה 600 קלוריות פנויות.
  // (היות והמערך כבר סונן בשלב 3, אנחנו בטוחים שהקלוריות לא חורגות מהיעד).
  finalScore += combo.calories;

  // 3. איכות המנה (רלוונטי תמיד, גם אם remainingProtein <= 0) - בונוס קטן ליחס חלבון-לקלוריה
  const proteinDensity = (combo.protein / Math.max(combo.calories, 1)) * 100;
  finalScore += proteinDensity;

  return finalScore;
}

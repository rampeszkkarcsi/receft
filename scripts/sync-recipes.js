const { GoogleSpreadsheet } = require("google-spreadsheet");
const fs = require("fs");
const path = require("path");

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

async function main() {
  if (!SHEET_ID) {
    console.error("GOOGLE_SHEET_ID is not set");
    process.exit(1);
  }

  const doc = new GoogleSpreadsheet(SHEET_ID);

  // Public sheet esetén nem kell auth, de a google-spreadsheet library néha auth-ot vár.
  // Ha hibát kapsz, akkor service account auth-ot kell beállítani (azt majd külön leírom).
  // Egyelőre próbáljuk meg auth nélkül:
  try {
    await doc.getInfo();
  } catch (err) {
    console.error("Error accessing sheet (maybe auth is needed):", err.message);
    // Itt lehetne service account auth-ot beállítani, ha szükséges.
    // Egyszerűsítésképp most feltételezzük, hogy public sheet és működik.
    process.exit(1);
  }

  const sheets = await doc.getSheets();
  const sheet = sheets[0]; // első lap
  const rows = await sheet.getRows();

  const recipesPath = path.join(__dirname, "..", "recipes.json");

  let recipes = [];
  if (fs.existsSync(recipesPath)) {
    const content = fs.readFileSync(recipesPath, "utf-8");
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      recipes = parsed;
    } else {
      recipes = [parsed];
    }
  }

  // Új receptek hozzáadása
  // Egyszerűsítés: minden sort hozzáadunk, nincs "feldolgozva" jelölés.
  // Később lehet finomítani (pl. egy "processed" oszlop).
  for (const row of rows) {
    const title = row.get("Recept címe")?.trim();
    const ingredientsText = row.get("Hozzávalók")?.trim();
    const instructionsText = row.get("Elkészítés")?.trim();
    const prepTimeMin = parseInt(row.get("Előkészítési idő (perc)") || "0", 10);
    const cookTimeMin = parseInt(row.get("Sütési/főzési idő (perc)") || "0", 10);
    const imageUrl = row.get("Kép URL")?.trim();
    const notes = row.get("Megjegyzés")?.trim();

    if (!title || !ingredientsText || !instructionsText) {
      continue; // hiányos sor, kihagyjuk
    }

    const ingredients = ingredientsText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const instructionsRaw = instructionsText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const instructions = instructionsRaw.map((text) => ({
      "@type": "HowToStep",
      text,
    }));

    const newRecipe = {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: title,
      recipeIngredient: ingredients,
      recipeInstructions: instructions,
      prepTime: `PT${prepTimeMin}M`,
      cookTime: `PT${cookTimeMin}M`,
      "x-recipe-keeper": {
        recipeId: crypto.randomUUID(),
        recipeShareId: "",
        recipeIsFavourite: "False",
        recipeRating: "0",
        name: title,
        recipeCourse: "",
        recipeSource: "",
        recipeYield: "",
        prepTime: `PT${prepTimeMin}M`,
        cookTime: `PT${cookTimeMin}M`,
        recipeIngredients: ingredients,
        recipeDirections: instructionsRaw,
        recipeNotes: notes ? [notes] : [],
      },
    };

    if (imageUrl) {
      newRecipe.image = imageUrl;
      newRecipe["x-recipe-keeper"].recipeImage = imageUrl;
    }

    if (notes) {
      newRecipe.description = notes;
    }

    // Ellenőrizzük, hogy nincs-e már ilyen című recept (egyszerű duplikáció-védelem)
    const exists = recipes.some((r) => r.name === title || r["x-recipe-keeper"]?.name === title);
    if (!exists) {
      recipes.push(newRecipe);
    }
  }

  // Visszaírás
  const content = JSON.stringify(recipes, null, 2);
  fs.writeFileSync(recipesPath, content, "utf-8");
  console.log("Recipes synced successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
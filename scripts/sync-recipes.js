const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const fs = require("fs");
const path = require("path");

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_JSON_RAW = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

function parseServiceAccountJson(jsonStr) {
  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: " + err.message);
  }
}

async function main() {
  if (!SHEET_ID) {
    throw new Error("GOOGLE_SHEET_ID is not set");
  }
  if (!SERVICE_ACCOUNT_JSON_RAW) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  }

  const credentials = parseServiceAccountJson(SERVICE_ACCOUNT_JSON_RAW);

  const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const doc = new GoogleSpreadsheet(SHEET_ID, auth);

  await doc.loadInfo();

  if (!doc.sheetsByIndex || doc.sheetsByIndex.length === 0) {
    throw new Error("Nem található munkalap a Google Táblázatban.");
  }

  const sheet = doc.sheetsByIndex[0];
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

  // Ellenőrizzük, hogy van-e "Feldolgozva" oszlop, ha nincs, létrehozzuk
  const headers = sheet.headerValues || [];
  if (!headers.includes("Feldolgozva")) {
    await sheet.setHeaderRow([...headers, "Feldolgozva"]);
  }

  let newCount = 0;

  for (const row of rows) {
    const processed = row.get("Feldolgozva")?.trim()?.toLowerCase();
    if (processed === "igen" || processed === "yes" || processed === "1") {
      continue; // már feldolgoztuk ezt a sort
    }

    const title = row.get("Recept címe")?.trim();
    const ingredientsText = row.get("Hozzávalók (soronként)")?.trim();
    const instructionsText = row.get("Elkészítés (soronként)")?.trim();
    const prepTimeMin = parseInt(row.get("Előkészítési idő (perc)") || "0", 10);
    const cookTimeMin = parseInt(row.get("Sütési/főzési idő (perc)") || "0", 10);
    const imageUrl = row.get("Kép")?.trim();
    const notes = row.get("Megjegyzés")?.trim();

    if (!title || !ingredientsText || !instructionsText) {
      // Hiányos sor, de megjelöljük feldolgozottnak, hogy ne próbálkozzon újra
      row.set("Feldolgozva", "igen");
      await row.save();
      continue;
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
      // Drive link átalakítása közvetlen képlinkké
      let directImageUrl = imageUrl;
      
      // 1. formátum: https://drive.google.com/file/d/FILE_ID/view
      const driveMatch1 = imageUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (driveMatch1) {
        const fileId = driveMatch1[1];
        directImageUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;
      }
      
      // 2. formátum: https://drive.google.com/open?id=FILE_ID
      const driveMatch2 = imageUrl.match(/open\?id=([a-zA-Z0-9_-]+)/);
      if (driveMatch2) {
        const fileId = driveMatch2[1];
        directImageUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;
      }
      
      newRecipe.image = directImageUrl;
      newRecipe["x-recipe-keeper"].recipeImage = directImageUrl;
    }

    if (notes) {
      newRecipe.description = notes;
    }

    // Duplikáció-védelem: ha már van ilyen című recept, nem adjuk hozzá újra
    const exists = recipes.some(
      (r) => r.name === title || r["x-recipe-keeper"]?.name === title
    );
    if (!exists) {
      recipes.push(newRecipe);
      newCount++;
    }

    // Mindenképp megjelöljük feldolgozottnak
    row.set("Feldolgozva", "igen");
    await row.save();
  }

  if (newCount === 0) {
    console.log("No new recipes to add.");
  } else {
    console.log(`Added ${newCount} new recipe(s).`);
  }

  const content = JSON.stringify(recipes, null, 2);
  fs.writeFileSync(recipesPath, content, "utf-8");
  console.log("Recipes synced successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
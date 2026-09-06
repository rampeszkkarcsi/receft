const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const https = require("https");

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_JSON_RAW = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

function parseServiceAccountJson(jsonStr) {
  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: " + err.message);
  }
}

async function downloadImageFromDrive(auth, fileId, destPath) {
  const drive = google.drive({ version: "v3", auth });

  const dest = fs.createWriteStream(destPath);

  const res = await drive.files.get(
    {
      fileId: fileId,
      alt: "media",
    },
    { responseType: "stream" }
  );

  return new Promise((resolve, reject) => {
    res.data
      .on("end", () => {
        console.log(`Image downloaded to ${destPath}`);
        resolve();
      })
      .on("error", (err) => {
        console.error("Error downloading image:", err);
        reject(err);
      })
      .pipe(dest);
  });
}

// ÚJ FÜGGVÉNY: Recept letöltése URL-ről
async function fetchRecipeFromUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          // JSON-LD schema.org/Recipe keresése
          const jsonLdMatch = data.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/);
          if (jsonLdMatch) {
            const jsonLd = JSON.parse(jsonLdMatch[1]);
            
            // Ha tömb, keressük a Recipe típust
            const recipes = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
            const recipe = recipes.find(r => r["@type"] === "Recipe" || (Array.isArray(r["@type"]) && r["@type"].includes("Recipe")));
            
            if (recipe) {
              console.log(`Recipe found on page: ${recipe.name}`);
              resolve(recipe);
              return;
            }
          }
          
          // Ha nincs JSON-LD, null-t adunk vissza, és használjuk a manuális mezőket
          console.log(`No schema.org/Recipe found on page, will use manual fields`);
          resolve(null);
        } catch (err) {
          console.error(`Error parsing recipe from URL: ${err.message}`);
          resolve(null);
        }
      });
    }).on("error", (err) => {
      console.error(`Error fetching URL: ${err.message}`);
      resolve(null);
    });
  });
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
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });

  const doc = new GoogleSpreadsheet(SHEET_ID, auth);

  await doc.loadInfo();

  if (!doc.sheetsByIndex || doc.sheetsByIndex.length === 0) {
    throw new Error("Nem található munkalap a Google Táblázatban.");
  }

  const sheet = doc.sheetsByIndex[0];
  const rows = await sheet.getRows();

  const recipesPath = path.join(__dirname, "..", "recipes.json");
  const imagesDir = path.join(__dirname, "..", "images");

  // images mappa létrehozása, ha nem létezik
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }

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

    // ÚJ: Recept URL-je oszlop olvasása
    const recipeUrl = row.get("Recept URL-je")?.trim();
    
    let title, ingredientsText, instructionsText, prepTimeMin, cookTimeMin, notes, imageUrl;
    let recipeFromUrl = null;

    if (recipeUrl) {
      console.log(`Fetching recipe from URL: ${recipeUrl}`);
      recipeFromUrl = await fetchRecipeFromUrl(recipeUrl);
      
      if (recipeFromUrl) {
        // Ha van JSON-LD Recipe, azt használjuk
        title = recipeFromUrl.name || row.get("Recept címe")?.trim();
        ingredientsText = Array.isArray(recipeFromUrl.recipeIngredient) 
          ? recipeFromUrl.recipeIngredient.join("\n") 
          : (recipeFromUrl.recipeIngredient || "");
        
        // Elkészítés lépések
        let instructionsRaw = [];
        if (Array.isArray(recipeFromUrl.recipeInstructions)) {
          instructionsRaw = recipeFromUrl.recipeInstructions
            .map(step => typeof step === "string" ? step : (step.text || ""))
            .filter(text => text.length > 0);
        } else if (typeof recipeFromUrl.recipeInstructions === "string") {
          instructionsRaw = [recipeFromUrl.recipeInstructions];
        }
        instructionsText = instructionsRaw.join("\n");
        
        prepTimeMin = parseInt(row.get("Előkészítési idő (perc)") || "0", 10);
        cookTimeMin = parseInt(row.get("Sütési/főzési idő (perc)") || "0", 10);
        notes = row.get("Megjegyzés")?.trim();
        imageUrl = row.get("Kép")?.trim();
        
        console.log(`Recipe fetched successfully: ${title}`);
      } else {
        // Ha nincs JSON-LD, használjuk a manuális mezőket
        console.log(`No recipe data found on page, using manual fields`);
        title = row.get("Recept címe")?.trim();
        ingredientsText = row.get("Hozzávalók (soronként)")?.trim();
        instructionsText = row.get("Elkészítés (soronként)")?.trim();
        prepTimeMin = parseInt(row.get("Előkészítési idő (perc)") || "0", 10);
        cookTimeMin = parseInt(row.get("Sütési/főzési idő (perc)") || "0", 10);
        notes = row.get("Megjegyzés")?.trim();
        imageUrl = row.get("Kép")?.trim();
      }
    } else {
      // Nincs URL, használjuk a manuális mezőket
      title = row.get("Recept címe")?.trim();
      ingredientsText = row.get("Hozzávalók (soronként)")?.trim();
      instructionsText = row.get("Elkészítés (soronként)")?.trim();
      prepTimeMin = parseInt(row.get("Előkészítési idő (perc)") || "0", 10);
      cookTimeMin = parseInt(row.get("Sütési/főzési idő (perc)") || "0", 10);
      notes = row.get("Megjegyzés")?.trim();
      imageUrl = row.get("Kép")?.trim();
    }

    // ÚJ: Ha van URL, csak a cím kell (a többi jöhet az URL-ről)
    // Ha nincs URL, akkor a cím + hozzávalók + elkészítés kötelező
    if (recipeUrl) {
      // Van URL: csak a cím kötelező
      if (!title) {
        console.log(`Skipping row: URL van, de cím nincs`);
        // Nem jelöljük feldolgozottnak, hogy később ki lehessen tölteni a címet
        continue;
      }
    } else {
      // Nincs URL: cím + hozzávalók + elkészítés kötelező
      if (!title || !ingredientsText || !instructionsText) {
        console.log(`Skipping row: nincs URL, és hiányos mezők`);
        // Nem jelöljük feldolgozottnak, hogy később ki lehessen tölteni
        continue;
      }
    }

    // Ha ideértünk, a sor érvényes
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

    // Kép letöltése és feltöltése a repo-ba
    if (imageUrl) {
      // Drive file ID kinyerése a linkből
      let fileId = null;
      
      // 1. formátum: https://drive.google.com/file/d/FILE_ID/view
      const driveMatch1 = imageUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (driveMatch1) {
        fileId = driveMatch1[1];
      }
      
      // 2. formátum: https://drive.google.com/open?id=FILE_ID
      const driveMatch2 = imageUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (driveMatch2 && !fileId) {
        fileId = driveMatch2[1];
      }

      if (fileId) {
        // Kép letöltése
        const ext = path.extname(fileId) || ".jpg"; // alapértelmezett .jpg
        const safeTitle = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        const imageName = `${safeTitle}${ext}`;
        const imagePath = path.join(imagesDir, imageName);
        const relativeImagePath = `images/${imageName}`;

        try {
          await downloadImageFromDrive(auth, fileId, imagePath);
          newRecipe.image = relativeImagePath;
          newRecipe["x-recipe-keeper"].recipeImage = relativeImagePath;
          console.log(`Image uploaded: ${relativeImagePath}`);
        } catch (err) {
          console.error(`Failed to download image for ${title}:`, err.message);
          // Kép nélkül folytatjuk
        }
      } else {
        console.log(`No valid Drive file ID found in: ${imageUrl}`);
      }
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
// =============================
// KONFIGURÁCIÓ – IDE ÍRD A SAJÁT ADATAIDAT
// =============================

const GITHUB_OWNER = "rampeszkkarcsi";
const GITHUB_REPO = "receft";
const GITHUB_TOKEN = "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"; // <-- IDE MÁSOLD A SAJÁT TOKENED!

const RECIPES_FILE_PATH = "recipes.json";
const IMAGES_FOLDER = "images";

const PASSWORD = "kiscsalád6";

// =============================
// JELSZÓ ELLENŐRZÉS
// =============================

const passwordInput = document.getElementById("passwordInput");
const checkPasswordBtn = document.getElementById("checkPasswordBtn");
const passwordError = document.getElementById("passwordError");
const recipeForm = document.getElementById("recipeForm");

checkPasswordBtn.addEventListener("click", () => {
  if (passwordInput.value === PASSWORD) {
    passwordError.textContent = "";
    recipeForm.style.display = "block";
    checkPasswordBtn.disabled = true;
    passwordInput.disabled = true;
  } else {
    passwordError.textContent = "Helytelen jelszó.";
    recipeForm.style.display = "none";
  }
});

// =============================
// ŰRLAP KEZELÉS
// =============================

const form = document.getElementById("recipeForm");
const submitBtn = document.getElementById("submitBtn");
const formError = document.getElementById("formError");
const formSuccess = document.getElementById("formSuccess");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.textContent = "";
  formSuccess.textContent = "";
  submitBtn.disabled = true;

  try {
    const title = document.getElementById("titleInput").value.trim();
    const ingredientsText = document.getElementById("ingredientsInput").value.trim();
    const instructionsText = document.getElementById("instructionsInput").value.trim();
    const prepTimeMin = parseInt(document.getElementById("prepTimeInput").value || "0", 10);
    const cookTimeMin = parseInt(document.getElementById("cookTimeInput").value || "0", 10);
    const notes = document.getElementById("notesInput").value.trim();
    const imageFile = document.getElementById("imageInput").files[0];

    if (!title || !ingredientsText || !instructionsText) {
      throw new Error("A cím, hozzávalók és elkészítés mezők kötelezőek.");
    }

    // Hozzávalók tömbbé
    const ingredients = ingredientsText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    // Elkészítés lépések tömbbé
    const instructionsRaw = instructionsText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const instructions = instructionsRaw.map((text) => ({
      "@type": "HowToStep",
      text,
    }));

    // Kép kezelése (ha van)
    let imagePath = "";
    if (imageFile) {
      const ext = imageFile.name.split(".").pop().toLowerCase();
      const safeTitle = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const imageName = `${safeTitle}.${ext}`;
      imagePath = `${IMAGES_FOLDER}/${imageName}`;

      await uploadImageToGitHub(imageFile, imagePath);
    }

    // Recept objektum összeállítása (schema.org/Recipe)
    const newRecipe = {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: title,
      recipeIngredient: ingredients,
      recipeInstructions: instructions,
      prepTime: `PT${prepTimeMin}M`,
      cookTime: `PT${cookTimeMin}M`,
      x-recipe-keeper: {
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

    if (imagePath) {
      newRecipe.image = imagePath;
      newRecipe["x-recipe-keeper"].recipeImage = imagePath;
    }

    if (notes) {
      newRecipe.description = notes;
    }

    // Jelenlegi recipes.json letöltése
    const currentContent = await downloadRecipesFile();
    let recipes = [];
    if (currentContent) {
      // Megnézzük, hogy a fájl egy tömb, vagy { recipes: [...] } vagy más
      if (Array.isArray(currentContent)) {
        recipes = currentContent;
      } else if (currentContent && typeof currentContent === "object") {
        // Ha van benne recipes tömb
        if (Array.isArray(currentContent.recipes)) {
          recipes = currentContent.recipes;
        } else {
          // Ha maga az objektum egy recept (ritka), akkor tömbbe tesszük
          recipes = [currentContent];
        }
      }
    }

    // Új recept hozzáadása
    recipes.push(newRecipe);

    // Visszafeltöltés
    await uploadRecipesFile(recipes);

    formSuccess.textContent =
      "Recept sikeresen hozzáadva! Néhány perc múlva megjelenik az oldalon (GitHub Pages frissülés).";
    form.reset();
  } catch (err) {
    console.error(err);
    formError.textContent = "Hiba történt: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

// =============================
// GITHUB API SEGÉDFÜGGVÉNYEK
// =============================

async function downloadRecipesFile() {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${RECIPES_FILE_PATH}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `token ${GITHUB_TOKEN}`,
    },
  });

  if (!res.ok) {
    if (res.status === 404) {
      // Nincs még recipes.json, üres tömböt adunk vissza
      return [];
    }
    throw new Error("Nem sikerült letölteni a recipes.json fájlt.");
  }

  const data = await res.json();
  const contentBase64 = data.content;
  const contentStr = atob(contentBase64);
  const json = JSON.parse(contentStr);
  return json;
}

async function uploadRecipesFile(recipes) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${RECIPES_FILE_PATH}`;

  // Először le kell kérni a fájl sha-ját (ha létezik már)
  let sha = null;
  const getRes = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `token ${GITHUB_TOKEN}`,
    },
  });
  if (getRes.ok) {
    const getData = await getRes.json();
    sha = getData.sha;
  }

  const contentStr = JSON.stringify(recipes, null, 2);
  const contentBase64 = btoa(unescape(encodeURIComponent(contentStr)));

  const body = {
    message: "Új recept hozzáadva (add-recipe űrlappal)",
    content: contentBase64,
  };
  if (sha) {
    body.sha = sha;
  }

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `token ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error("Nem sikerült feltölteni a recipes.json fájlt: " + errText);
  }
}

async function uploadImageToGitHub(file, path) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;

  // Lehet, hogy már létezik ugyanilyen néven – ekkor sha kell
  let sha = null;
  const getRes = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `token ${GITHUB_TOKEN}`,
    },
  });
  if (getRes.ok) {
    const getData = await getRes.json();
    sha = getData.sha;
  }

  const reader = new FileReader();
  const base64Promise = new Promise((resolve, reject) => {
    reader.onload = () => {
      // reader.result data:image/...;base64,XXXX formátumú
      const base64Full = reader.result;
      const base64 = base64Full.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
  });
  reader.readAsDataURL(file);
  const base64 = await base64Promise;

  const body = {
    message: `Kép feltöltve: ${path}`,
    content: base64,
  };
  if (sha) {
    body.sha = sha;
  }

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `token ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error("Nem sikerült feltölteni a képet: " + errText);
  }
}
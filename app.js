const recipesEl = document.getElementById('recipes');
const searchEl = document.getElementById('search');
const resultCountEl = document.getElementById('resultCount');
const template = document.getElementById('recipeTemplate');

const PLACEHOLDER = 'placeholder.svg';

let recipes = [];

function normalize(str) {
  return (str || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getTitle(recipe) {
  return recipe.name || recipe.title || 'Névtelen recept';
}

function getIngredients(recipe) {
  return recipe.recipeIngredient || [];
}

function getSteps(recipe) {
  return Array.isArray(recipe.recipeInstructions)
    ? recipe.recipeInstructions
        .map(s => typeof s === 'string' ? s : (s.text || ''))
        .filter(Boolean)
    : [];
}

function getImage(recipe) {
  return recipe.image || '';
}

function getMeta(recipe) {
  const parts = [];
  if (recipe.prepTime) parts.push(`Előkészítés: ${recipe.prepTime}`);
  if (recipe.cookTime) parts.push(`Sütés/főzés: ${recipe.cookTime}`);
  if (recipe.recipeYield) parts.push(`Adag: ${recipe.recipeYield}`);
  return parts.join(' • ');
}

function recipeSearchText(recipe) {
  return normalize([
    getTitle(recipe),
    ...getIngredients(recipe),
    ...getSteps(recipe)
  ].join(' | '));
}

function escapeHtml(str) {
  return (str || '').toString().replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightText(text, query) {
  if (!query) return escapeHtml(text);

  const re = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  const parts = text.split(re);

  return parts.map(part => {
    if (normalize(part) === normalize(query)) {
      return `<span class="highlight">${escapeHtml(part)}</span>`;
    }
    return escapeHtml(part);
  }).join('');
}

function render(list, query = '') {
  recipesEl.innerHTML = '';
  const fragment = document.createDocumentFragment();

  list.forEach(recipe => {
    const node = template.content.cloneNode(true);
    const img = node.querySelector('.thumb');
    const title = node.querySelector('.title');
    const meta = node.querySelector('.meta');
    const ingredients = node.querySelector('.ingredients');
    const steps = node.querySelector('.steps');

    const titleText = getTitle(recipe);
    title.innerHTML = highlightText(titleText, query);

    meta.textContent = getMeta(recipe);

    ingredients.innerHTML = getIngredients(recipe)
      .slice(0, 12)
      .map(x => `<span class="tag">${highlightText(x, query)}</span>`)
      .join('');

    const stepHtml = getSteps(recipe)
      .slice(0, 2)
      .map(s => `<div>${highlightText(s, query)}</div>`)
      .join('');
    steps.innerHTML = stepHtml;

    const image = getImage(recipe);
    img.alt = titleText;

if (image) {
  img.src = image;
  img.onerror = function () {
    this.onerror = null;
    this.src = PLACEHOLDER;
    this.classList.add('placeholder');
  };
} else {
  img.src = PLACEHOLDER;
  img.classList.add('placeholder');
}

    fragment.appendChild(node);
  });

  recipesEl.appendChild(fragment);
  resultCountEl.textContent = `${list.length} recept`;
}

function filterRecipes(query) {
  const q = normalize(query).trim();
  if (!q) return recipes;

  const words = q.split(/\s+/).filter(Boolean);

  return recipes.filter(recipe => {
    const text = recipeSearchText(recipe);
    return words.every(word => text.includes(word));
  });
}

async function init() {
  try {
    const res = await fetch('recipes.json');
    recipes = await res.json();
    render(recipes);
  } catch (err) {
    recipesEl.innerHTML = '<p>Nem sikerült betölteni a recipes.json fájlt.</p>';
    console.error(err);
  }
}

searchEl.addEventListener('input', () => {
  const filtered = filterRecipes(searchEl.value);
  render(filtered, searchEl.value.trim());
});

init();
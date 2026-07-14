const recipesEl = document.getElementById('recipes');
const searchEl = document.getElementById('search');
const resultCountEl = document.getElementById('resultCount');
const template = document.getElementById('recipeTemplate');

const PLACEHOLDER = 'placeholder.svg';

let recipes = [];
let expandedId = null;

function normalize(str) {
  return (str || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getId(recipe, fallback) {
  return recipe.id || recipe.recipeId || fallback;
}

function getTitle(recipe) {
  return recipe.name || recipe.title || 'Névtelen recept';
}

function getIngredients(recipe) {
  return recipe.recipeIngredient || [];
}

function getSteps(recipe) {
  const steps = recipe.recipeInstructions || [];
  return Array.isArray(steps)
    ? steps.map(s => typeof s === 'string' ? s : (s.text || '')).filter(Boolean)
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

function visibleIngredients(recipe, expanded) {
  const ingredients = getIngredients(recipe);
  if (expanded) return ingredients;
  return ingredients.slice(0, 4);
}

function render(list, query = '') {
  recipesEl.innerHTML = '';
  const fragment = document.createDocumentFragment();

  list.forEach((recipe, index) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector('.card');
    const img = node.querySelector('.thumb');
    const toggle = node.querySelector('.card-toggle');
    const title = node.querySelector('.title');
    const meta = node.querySelector('.meta');
    const previewIngredients = node.querySelector('.preview-ingredients');
    const expandedIngredients = node.querySelector('.expanded-ingredients');
    const steps = node.querySelector('.steps');
    const expandedBlock = node.querySelector('.card-expanded');

    const id = getId(recipe, index);
    const titleText = getTitle(recipe);
    const isExpanded = expandedId === id;

    card.dataset.id = id;
    card.classList.toggle('expanded', isExpanded);
    toggle.setAttribute('aria-expanded', String(isExpanded));

    title.innerHTML = highlightText(titleText, query);
    meta.textContent = getMeta(recipe);

    previewIngredients.innerHTML = visibleIngredients(recipe, false)
      .map(x => `<span class="tag">${highlightText(x, query)}</span>`)
      .join('');

    expandedIngredients.innerHTML = visibleIngredients(recipe, true)
      .map(x => `<span class="tag">${highlightText(x, query)}</span>`)
      .join('');

    steps.innerHTML = getSteps(recipe)
      .map(s => `<div>${highlightText(s, query)}</div>`)
      .join('');

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

    toggle.addEventListener('click', () => {
      expandedId = expandedId === id ? null : id;
      render(filterRecipes(searchEl.value), searchEl.value.trim());
    });

    expandedBlock.style.display = isExpanded ? 'block' : 'none';

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
  if (expandedId && !filtered.some((r, i) => getId(r, i) === expandedId)) {
    expandedId = null;
  }
  render(filtered, searchEl.value.trim());
});

init();
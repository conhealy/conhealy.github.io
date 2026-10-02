const REMOTE_API_ROOT = "https://collectionapi.metmuseum.org/public/collection";
const IS_LOCAL_SERVER = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const API_ROOT = IS_LOCAL_SERVER ? "/met-api" : REMOTE_API_ROOT;
const SEARCH_URL = `${API_ROOT}/v1.1/search`;
const STORAGE_KEY = "stillroom-preferences-met-v1";
const ARTIST_STORAGE_KEY = "stillroom-artist-preferences-met-v1";
const MEDIA_STORAGE_KEY = "stillroom-media-met-v1";
const RECENT_STORAGE_KEY = "stillroom-recent-artworks-met-v1";
const RECENT_ARTWORK_LIMIT = 100;
const REQUEST_TIMEOUT_MS = 8000;
const RESULT_LIMIT = 24;
const resultTotals = new Map();

const periodBands = [
  { label: "before 500", dateBegin: -10000, dateEnd: 499 },
  { label: "500-1399", dateBegin: 500, dateEnd: 1399 },
  { label: "1400-1599", dateBegin: 1400, dateEnd: 1599 },
  { label: "1600-1799", dateBegin: 1600, dateEnd: 1799 },
  { label: "the 19th century", dateBegin: 1800, dateEnd: 1899 },
  { label: "1900-1929", dateBegin: 1900, dateEnd: 1929 }
];

const mediumStrata = [
  "Paintings", "Sculpture", "Ceramics", "Textiles", "Furniture", "Photographs",
  "Drawings", "Prints", "Glass", "Jewelry", "Metalwork", "Musical Instruments"
];
const defaultMedia = ["Paintings"];
const fineArtMedia = ["Paintings", "Drawings", "Prints", "Photographs", "Sculpture"];

const geographyStrata = [
  "Africa", "China", "Japan", "India", "Egypt", "Europe", "France", "Italy",
  "Mexico", "United States", "New York", "Oceania"
];

const cultureStrata = [
  "African", "American", "Chinese", "Dutch", "Egyptian", "French", "Greek",
  "Indian", "Islamic", "Italian", "Japanese", "Korean", "Mexican", "Roman"
];

const fallbackArtwork = {
  id: "fallback-garden",
  title: "The Garden at Dusk",
  artist: "Mara Ellison",
  year: "2024",
  dateStart: 2024,
  medium: "Oil on linen",
  dimensions: "92 x 74 cm",
  image: "assets/garden-at-dusk.png",
  imageCandidates: ["assets/garden-at-dusk.png"],
  objectUrl: "",
  description: "The live collection could not be reached. This local work is keeping the room open while you try again.",
  department_title: "Local fallback",
  tags: ["painting", "oil on linen"]
};

const state = {
  current: fallbackArtwork,
  preferences: loadPreferences(),
  artistPreferences: loadArtistPreferences(),
  reaction: null,
  loading: false,
  query: [],
  selectionMode: "Connecting to The Metropolitan Museum of Art",
  departments: null,
  selectedMedia: loadMedia(),
  recentArtworkIds: loadRecentArtworkIds(),
  cooldownUntil: 0,
  cooldownTimer: null
};

const ui = Object.fromEntries([
  "painting", "loading-veil", "reaction-status", "like-button", "dislike-button",
  "selection-mode", "artwork-context", "artwork-title", "artwork-artist", "artwork-year",
  "artwork-description", "artwork-medium", "artwork-dimensions", "next-button", "word-cloud",
  "empty-taste", "reset-button", "query-text", "media-filter-summary", "media-filter-form",
  "media-options", "media-fine-art", "media-all", "next-button-label", "artwork-link"
].map((id) => [id, document.getElementById(id)]));

function loadPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function savePreferences() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.preferences));
}

function loadArtistPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(ARTIST_STORAGE_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function saveArtistPreferences() {
  localStorage.setItem(ARTIST_STORAGE_KEY, JSON.stringify(state.artistPreferences));
}

function loadMedia() {
  try {
    const stored = JSON.parse(localStorage.getItem(MEDIA_STORAGE_KEY) || "null");
    const valid = Array.isArray(stored) ? stored.filter((medium) => mediumStrata.includes(medium)) : [];
    const isPreviousDefault = valid.length === fineArtMedia.length &&
      fineArtMedia.every((medium) => valid.includes(medium));
    if (isPreviousDefault) return [...defaultMedia];
    return valid.length ? valid : [...defaultMedia];
  } catch {
    return [...defaultMedia];
  }
}

function saveMedia() {
  localStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify(state.selectedMedia));
}

function loadRecentArtworkIds() {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) || "[]");
    if (!Array.isArray(stored)) return [];
    return [...new Set(stored.map(String).filter((id) => /^\d+$/.test(id)))]
      .slice(-RECENT_ARTWORK_LIMIT);
  } catch {
    return [];
  }
}

function rememberArtwork(artworkId) {
  const id = String(artworkId);
  state.recentArtworkIds = state.recentArtworkIds
    .filter((recentId) => recentId !== id)
    .concat(id)
    .slice(-RECENT_ARTWORK_LIMIT);
  localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(state.recentArtworkIds));
}

function getExcludedArtworkIds() {
  const excludedIds = new Set(state.recentArtworkIds);
  if (state.current?.id) excludedIds.add(String(state.current.id));
  return excludedIds;
}

function weightedTagSample(limit = 6) {
  const pool = Object.entries(state.preferences)
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .map(([tag, count]) => ({ tag, weight: count }));
  const selected = [];

  while (pool.length && selected.length < limit) {
    const total = pool.reduce((sum, item) => sum + item.weight, 0);
    let cursor = Math.random() * total;
    let pickedIndex = pool.length - 1;
    for (let index = 0; index < pool.length; index += 1) {
      cursor -= pool[index].weight;
      if (cursor <= 0) {
        pickedIndex = index;
        break;
      }
    }
    selected.push(pool[pickedIndex].tag);
    pool.splice(pickedIndex, 1);
  }
  return selected;
}

function weightedArtistSample(limit = 5) {
  const pool = Object.entries(state.artistPreferences)
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .map(([artist, count]) => ({ artist, weight: count }));
  const selected = [];

  while (pool.length && selected.length < limit) {
    const total = pool.reduce((sum, item) => sum + item.weight, 0);
    let cursor = Math.random() * total;
    let pickedIndex = pool.length - 1;
    for (let index = 0; index < pool.length; index += 1) {
      cursor -= pool[index].weight;
      if (cursor <= 0) {
        pickedIndex = index;
        break;
      }
    }
    selected.push(pool[pickedIndex].artist);
    pool.splice(pickedIndex, 1);
  }
  return selected;
}

function adjustTags(direction) {
  state.current.tags.forEach((tag) => {
    const current = state.preferences[tag] || 0;
    state.preferences[tag] = Math.max(0, current + direction);
    if (state.preferences[tag] === 0) delete state.preferences[tag];
  });
}

function adjustArtistPreference(direction) {
  const artist = state.current.artist?.trim();
  if (!artist || artist === "Maker unknown") return;
  const current = state.artistPreferences[artist] || 0;
  state.artistPreferences[artist] = Math.max(0, current + direction);
  if (state.artistPreferences[artist] === 0) delete state.artistPreferences[artist];
}

function chooseReaction(nextReaction) {
  if (state.loading || state.reaction === nextReaction) return;
  if (state.reaction === "like") {
    adjustTags(-1);
    adjustArtistPreference(-1);
  }
  if (state.reaction === "dislike") adjustTags(1);
  adjustTags(nextReaction === "like" ? 1 : -1);
  if (nextReaction === "like") adjustArtistPreference(1);
  state.reaction = nextReaction;
  savePreferences();
  saveArtistPreferences();
  renderReaction();
  renderTaste();
}

function buildUrl(base, parameters = {}) {
  const url = new URL(base, window.location.origin);
  Object.entries(parameters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  return url;
}

async function fetchJson(url, attempts = 2) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok) return response.json();
      const rateLimited = response.status === 403 || response.status === 429;
      const retryable = rateLimited || response.status >= 500;
      const error = new Error(`The Met request failed (${response.status}).`);
      error.status = response.status;
      error.isServiceFailure = retryable;
      error.isRateLimited = rateLimited;
      throw error;
    } catch (error) {
      if (error.isRateLimited) throw error;
      const retryable = !error.status || error.isServiceFailure;
      if (!retryable || attempt === attempts - 1) {
        error.isServiceFailure = retryable;
        throw error;
      }
    } finally {
      window.clearTimeout(timeout);
    }
    await pause(300 * (attempt + 1));
  }
  throw new Error("The Met request failed.");
}

function isServiceFailure(error) {
  return Boolean(error?.isServiceFailure);
}

function isCooldownActive() {
  return Date.now() < state.cooldownUntil;
}

function renderCooldown() {
  const seconds = Math.max(0, Math.ceil((state.cooldownUntil - Date.now()) / 1000));
  if (!seconds) {
    window.clearInterval(state.cooldownTimer);
    state.cooldownTimer = null;
    state.cooldownUntil = 0;
    ui["next-button"].disabled = state.loading;
    ui["next-button-label"].textContent = "Show another work";
    renderReaction();
    return;
  }

  ui["next-button"].disabled = true;
  ui["next-button-label"].textContent = `Available in ${seconds}s`;
  ui["reaction-status"].textContent = `The Met is limiting requests. Please wait ${seconds} seconds.`;
}

function startCooldown(milliseconds = 30000) {
  state.cooldownUntil = Date.now() + milliseconds;
  window.clearInterval(state.cooldownTimer);
  renderCooldown();
  state.cooldownTimer = window.setInterval(renderCooldown, 1000);
}

async function getDepartments() {
  if (state.departments) return state.departments;
  const payload = await fetchJson(`${API_ROOT}/v1/departments`);
  state.departments = payload.departments.filter((department) => ![16, 21].includes(department.departmentId));
  return state.departments;
}

async function chooseExplorationStratum() {
  const dimension = randomItem(["department", "medium", "geography", "period", "culture", "open collection"]);

  if (dimension === "department") {
    const department = randomItem(await getDepartments());
    return {
      note: `Exploring department: ${department.displayName}`,
      params: { departmentId: department.departmentId }
    };
  }

  if (dimension === "medium") {
    const medium = randomItem(state.selectedMedia);
    return { note: `Exploring medium: ${medium}`, params: { medium } };
  }

  if (dimension === "geography") {
    const geography = randomItem(geographyStrata);
    return { note: `Exploring geography: ${geography}`, params: { geoLocation: geography } };
  }

  if (dimension === "period") {
    const period = randomItem(periodBands);
    return {
      note: `Exploring period: ${period.label}`,
      params: { dateBegin: period.dateBegin, dateEnd: period.dateEnd }
    };
  }

  if (dimension === "culture") {
    const culture = randomItem(cultureStrata);
    return {
      note: `Exploring culture: ${culture}`,
      params: { q: culture, artistOrCulture: true }
    };
  }

  return { note: "Open exploration across The Met collection", params: {} };
}

async function searchObjectIds(parameters) {
  const baseParameters = { ...parameters, hasImages: true };
  if (!baseParameters.medium) baseParameters.medium = state.selectedMedia.join("|");
  const cacheKey = JSON.stringify(baseParameters);
  let total = resultTotals.get(cacheKey);

  if (total === undefined) {
    const firstPage = await fetchJson(buildUrl(SEARCH_URL, { ...baseParameters, offset: 0, limit: 1 }));
    total = firstPage.total || 0;
    resultTotals.set(cacheKey, total);
  }

  if (!total) return [];
  const accessible = Math.min(total, 10000);
  const maxOffset = Math.max(0, accessible - RESULT_LIMIT);
  const offset = Math.floor(Math.random() * (maxOffset + 1));
  const payload = await fetchJson(buildUrl(SEARCH_URL, {
    ...baseParameters,
    offset,
    limit: Math.min(RESULT_LIMIT, accessible)
  }));
  return shuffle(payload.objectIDs || []);
}

async function getEligibleArtwork(parameters, excludedIds, predicate = () => true) {
  const checkedIds = new Set();
  for (let searchAttempt = 0; searchAttempt < 3; searchAttempt += 1) {
    const objectIds = await searchObjectIds(parameters);
    for (const objectId of objectIds) {
      const id = String(objectId);
      if (excludedIds.has(id) || checkedIds.has(id)) continue;
      checkedIds.add(id);
      try {
        const raw = await fetchJson(`${API_ROOT}/v1/objects/${objectId}`);
        if (isEligible(raw) && predicate(raw)) return normalizeArtwork(raw);
      } catch (error) {
        if (isServiceFailure(error)) throw error;
        // Continue through this result window.
      }
    }
  }
  throw new Error("No displayable public-domain artwork was found.");
}

async function getExplorationArtwork(excludedIds) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stratum = await chooseExplorationStratum();
    try {
      return {
        artwork: await getEligibleArtwork(stratum.params, excludedIds),
        note: stratum.note
      };
    } catch (error) {
      if (isServiceFailure(error)) throw error;
      // Try another stratum.
    }
  }

  try {
    return {
      artwork: await getEligibleArtwork({}, excludedIds),
      note: "Open exploration across your selected media"
    };
  } catch (error) {
    if (isServiceFailure(error)) throw error;
    // Try each selected medium separately before giving up.
  }

  for (const medium of shuffle(state.selectedMedia)) {
    try {
      return {
        artwork: await getEligibleArtwork({ medium }, excludedIds),
        note: `Exploring medium: ${medium}`
      };
    } catch (error) {
      if (isServiceFailure(error)) throw error;
      // Continue through the user's selected media.
    }
  }

  throw new Error("The Met did not return a displayable artwork.");
}

async function getPreferenceArtwork(tags, excludedIds) {
  const querySizes = [...new Set([tags.length, Math.min(3, tags.length), 1])];
  for (const size of querySizes) {
    try {
      return await getEligibleArtwork({ q: tags.slice(0, size).join(" ") }, excludedIds);
    } catch (error) {
      if (isServiceFailure(error)) throw error;
      // Broaden the preference query.
    }
  }
  throw new Error("No preference match was found.");
}

async function getArtistArtwork(artist, excludedIds) {
  const normalizedArtist = artist.toLowerCase();
  const matchesArtist = (raw) => unique([
    raw.artistDisplayName,
    ...(raw.constituents || []).map((constituent) => constituent.name)
  ]).some((name) => {
    const normalizedName = name.toLowerCase();
    return normalizedName.includes(normalizedArtist) || normalizedArtist.includes(normalizedName);
  });

  return getEligibleArtwork(
    { q: artist, artistOrCulture: true },
    excludedIds,
    matchesArtist
  );
}

function isEligible(raw) {
  return Boolean(
    raw?.objectID &&
    raw.isPublicDomain &&
    (raw.primaryImageSmall || raw.primaryImage) &&
    raw.title &&
    extractTags(raw).length
  );
}

function normalizeArtwork(raw) {
  const descriptors = unique([
    raw.culture,
    raw.period,
    raw.classification,
    raw.country,
    raw.region
  ]);
  return {
    id: raw.objectID,
    title: raw.title,
    artist: raw.artistDisplayName || raw.constituents?.[0]?.name || "Maker unknown",
    year: raw.objectDate || "Date unknown",
    dateStart: raw.objectBeginDate,
    medium: raw.medium || raw.objectName || "Medium not recorded",
    dimensions: raw.dimensions || "Dimensions not recorded",
    image: raw.primaryImageSmall || raw.primaryImage,
    imageCandidates: unique([raw.primaryImageSmall, raw.primaryImage]),
    objectUrl: raw.objectURL || "",
    description: descriptors.length
      ? descriptors.join(" · ")
      : raw.creditLine || "No additional description is available for this work.",
    department_title: raw.department || "The Met collection",
    tags: extractTags(raw)
  };
}

function extractTags(raw) {
  return unique([
    ...(raw.tags || []).map((tag) => tag.term),
    raw.department,
    raw.objectName,
    raw.culture,
    raw.period,
    raw.dynasty,
    raw.reign,
    raw.classification,
    raw.medium,
    raw.country,
    raw.region,
    raw.subregion,
    raw.locale,
    raw.artistNationality
  ]).map((tag) => tag.toLowerCase());
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function pause(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function preloadImage(source, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => {
      image.src = "";
      reject(new Error("Artwork image request timed out."));
    }, timeoutMs);
    image.onload = () => {
      window.clearTimeout(timeout);
      resolve(source);
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("Artwork image could not be loaded."));
    };
    image.src = source;
  });
}

async function findWorkingImage(sources) {
  for (const source of sources) {
    try {
      await preloadImage(source);
      return source;
    } catch {
      // Try the next Met image size.
    }
  }
  throw new Error("No full-size image source could be loaded.");
}

async function showNext({ initial = false } = {}) {
  if (state.loading || isCooldownActive()) return;
  setLoading(true);
  const queryTags = weightedTagSample();
  const preferredArtists = weightedArtistSample();
  const excludedIds = getExcludedArtworkIds();
  const selectionRoll = Math.random();
  const requestedMode = selectionRoll < 1 / 3
    ? "exploration"
    : selectionRoll < 2 / 3
      ? "keywords"
      : "artist";
  let loaded = false;

  try {
    let next;
    let appliedMode = requestedMode;
    if (requestedMode === "keywords" && queryTags.length) {
      try {
        next = {
          artwork: await getPreferenceArtwork(queryTags, excludedIds),
          note: "Guided by your emerging taste"
        };
      } catch (error) {
        if (isServiceFailure(error)) throw error;
        next = await getExplorationArtwork(excludedIds);
        appliedMode = "exploration";
      }
    } else if (requestedMode === "artist" && preferredArtists.length) {
      for (const artist of preferredArtists) {
        try {
          next = {
            artwork: await getArtistArtwork(artist, excludedIds),
            note: `More from ${artist}`
          };
          break;
        } catch (error) {
          if (isServiceFailure(error)) throw error;
          // Try another liked artist before returning to exploration.
        }
      }
      if (!next) {
        next = await getExplorationArtwork(excludedIds);
        appliedMode = "exploration";
      }
    } else {
      next = await getExplorationArtwork(excludedIds);
      appliedMode = "exploration";
    }

    next.artwork.image = await findWorkingImage(next.artwork.imageCandidates);
    state.current = next.artwork;
    rememberArtwork(next.artwork.id);
    state.reaction = null;
    state.query = appliedMode === "keywords" ? queryTags : [];
    state.selectionMode = next.note;
    renderArtwork();
    loaded = true;
  } catch (error) {
    if (error.isRateLimited) {
      startCooldown();
      console.warn("The Met temporarily blocked requests. Waiting 30 seconds before retrying.", error);
      return;
    }
    const needsLocalServer = isServiceFailure(error) && window.location.protocol === "file:";
    state.selectionMode = needsLocalServer
      ? "Open Stillroom through its local server"
      : "The Met collection is temporarily unavailable";
    ui["reaction-status"].textContent = needsLocalServer
      ? "Browser security blocked the collection request. Use the local server URL."
      : initial
        ? "The live collection could not be reached. Try another work."
        : "We could not load another work. Please try again.";
    ui["selection-mode"].textContent = state.selectionMode;
    console.error(error);
  } finally {
    setLoading(false);
    if (loaded) renderReaction();
  }
}

function setLoading(isLoading) {
  state.loading = isLoading;
  ui["next-button"].disabled = isLoading || isCooldownActive();
  ui["like-button"].disabled = isLoading;
  ui["dislike-button"].disabled = isLoading;
  ui.painting.classList.toggle("is-changing", isLoading);
  ui["loading-veil"].classList.toggle("is-visible", isLoading);
}

function renderArtwork() {
  const artwork = state.current;
  delete ui.painting.dataset.fallbackAttempted;
  ui.painting.src = artwork.image;
  ui.painting.alt = `${artwork.title} by ${artwork.artist}`;
  ui.painting.classList.remove("painting");
  void ui.painting.offsetWidth;
  ui.painting.classList.add("painting");
  ui["selection-mode"].textContent = state.selectionMode;
  ui["artwork-context"].textContent = artwork.department_title;
  ui["artwork-title"].textContent = artwork.title;
  ui["artwork-artist"].textContent = artwork.artist;
  ui["artwork-year"].textContent = artwork.year;
  ui["artwork-description"].textContent = artwork.description;
  ui["artwork-medium"].textContent = artwork.medium;
  ui["artwork-dimensions"].textContent = artwork.dimensions;
  ui["artwork-link"].href = artwork.objectUrl || "#";
  ui["artwork-link"].hidden = !artwork.objectUrl;
  ui["query-text"].textContent = state.query.length
    ? `Preference search using ${formatList(state.query)}.`
    : state.selectionMode;
  renderReaction();
}

function renderReaction() {
  if (isCooldownActive()) {
    renderCooldown();
    return;
  }
  const liked = state.reaction === "like";
  const disliked = state.reaction === "dislike";
  ui["like-button"].classList.toggle("is-selected", liked);
  ui["like-button"].setAttribute("aria-pressed", String(liked));
  ui["dislike-button"].classList.toggle("is-selected", disliked);
  ui["dislike-button"].setAttribute("aria-pressed", String(disliked));
  if (!state.loading) {
    ui["reaction-status"].textContent = liked
      ? "Saved to your taste."
      : disliked
        ? "Noted. We'll look elsewhere."
        : "Does this work speak to you?";
  }
}

function renderTaste() {
  const preferences = Object.entries(state.preferences)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  ui["word-cloud"].replaceChildren();
  ui["empty-taste"].hidden = preferences.length > 0;

  preferences.slice(0, 30).forEach(([tag, count]) => {
    const word = document.createElement("span");
    word.className = "cloud-word";
    word.style.fontSize = `${Math.min(36, 14 + Math.sqrt(count) * 6)}px`;
    word.textContent = tag;
    word.setAttribute("aria-label", `${tag}, preference strength ${count}`);
    ui["word-cloud"].append(word);
  });
}

function formatList(items) {
  if (items.length < 2) return items[0] || "";
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function resetPreferences() {
  state.preferences = {};
  state.artistPreferences = {};
  state.reaction = null;
  state.query = [];
  savePreferences();
  saveArtistPreferences();
  ui["query-text"].textContent = state.selectionMode;
  renderReaction();
  renderTaste();
}

function setMediaCheckboxes(media) {
  const selected = new Set(media);
  ui["media-options"].querySelectorAll("input").forEach((input) => {
    input.checked = selected.has(input.value);
  });
  updateMediaSummary([...selected]);
}

function updateMediaSummary(media = state.selectedMedia) {
  const isPaintings = media.length === 1 && media[0] === "Paintings";
  const isFineArt = media.length === fineArtMedia.length &&
    fineArtMedia.every((medium) => media.includes(medium));
  ui["media-filter-summary"].textContent = isPaintings
    ? "Paintings"
    : isFineArt
      ? "Fine art"
    : media.length === mediumStrata.length
      ? "All media"
      : `${media.length} selected`;
}

function renderMediaFilters() {
  ui["media-options"].replaceChildren();
  mediumStrata.forEach((medium) => {
    const label = document.createElement("label");
    label.className = "media-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "media";
    input.value = medium;
    input.checked = state.selectedMedia.includes(medium);
    const text = document.createElement("span");
    text.textContent = medium;
    label.append(input, text);
    ui["media-options"].append(label);
  });
  updateMediaSummary();
}

function getCheckedMedia() {
  return [...ui["media-options"].querySelectorAll("input:checked")].map((input) => input.value);
}

function applyMediaFilters(event) {
  event.preventDefault();
  const selected = getCheckedMedia();
  if (!selected.length) {
    ui["reaction-status"].textContent = "Choose at least one medium.";
    return;
  }
  state.selectedMedia = selected;
  saveMedia();
  resultTotals.clear();
  updateMediaSummary();
  void showNext();
}

function registerWebMcpTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const tools = [
    {
      name: "rate_current_artwork",
      title: "Rate current artwork",
      description: "Like or dislike the artwork currently shown and update the visible taste profile.",
      inputSchema: { type: "object", properties: { reaction: { type: "string", enum: ["like", "dislike"] } }, required: ["reaction"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || !["like", "dislike"].includes(input.reaction)) throw new Error("reaction must be like or dislike");
        chooseReaction(input.reaction);
        return {
          artwork: state.current.title,
          reaction: state.reaction,
          preferences: { ...state.preferences },
          artistPreferences: { ...state.artistPreferences }
        };
      }
    },
    {
      name: "show_next_artwork",
      title: "Show next artwork",
      description: "Load another Met artwork using the same exploration and preference logic as the visible control.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute() {
        await showNext();
        return { artwork: state.current.title, selectionMode: state.selectionMode, queryTags: [...state.query] };
      }
    }
  ];
  tools.forEach((tool) => {
    try { void Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch { /* Unsupported preview context. */ }
  });
}

ui["like-button"].addEventListener("click", () => chooseReaction("like"));
ui["dislike-button"].addEventListener("click", () => chooseReaction("dislike"));
ui["next-button"].addEventListener("click", () => showNext());
ui["reset-button"].addEventListener("click", resetPreferences);
ui["media-filter-form"].addEventListener("submit", applyMediaFilters);
ui["media-fine-art"].addEventListener("click", () => setMediaCheckboxes(fineArtMedia));
ui["media-all"].addEventListener("click", () => setMediaCheckboxes(mediumStrata));
ui["media-options"].addEventListener("change", () => updateMediaSummary(getCheckedMedia()));
ui.painting.addEventListener("error", () => {
  if (ui.painting.dataset.fallbackAttempted) {
    ui.painting.removeAttribute("src");
    return;
  }
  ui.painting.dataset.fallbackAttempted = "true";
  ui.painting.src = fallbackArtwork.image;
  ui["reaction-status"].textContent = "The image is unavailable for this work.";
});

renderArtwork();
renderTaste();
renderMediaFilters();
registerWebMcpTools();
void showNext({ initial: true });

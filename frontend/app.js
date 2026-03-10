// ═══════════════════════════════════════════════════════════════
// SEZIONE 1 — CONFIGURAZIONE
// ═══════════════════════════════════════════════════════════════

const API_BASE_URL = 'http://localhost:3000/api';
const DDRAGON_BASE = 'https://ddragon.leagueoflegends.com';

// Versione patch DataDragon — aggiornare ad ogni major patch LoL
const VERSION = '14.10.1';


// ═══════════════════════════════════════════════════════════════
// SEZIONE 2 — DOM REFERENCES
// ═══════════════════════════════════════════════════════════════

const searchForm     = document.querySelector('#search-form');
const regionSelect   = document.querySelector('#region-select');
const summonerInput  = document.querySelector('#summoner-input');

const profileSection = document.querySelector('#profile-section');
const matchesSection = document.querySelector('#matches-section');
const loadingSection = document.querySelector('#loading-section');
const errorSection   = document.querySelector('#error-section');
const errorMessage   = document.querySelector('#error-message');

const summonerIcon   = document.querySelector('#summoner-icon');
const summonerName   = document.querySelector('#summoner-name');
const summonerLevel  = document.querySelector('#summoner-level');

const rankEmblem     = document.querySelector('#rank-emblem');
const rankTier       = document.querySelector('#rank-tier');
const rankLp         = document.querySelector('#rank-lp');
const rankWinrate    = document.querySelector('#rank-winrate');

const matchesList    = document.querySelector('#matches-list');


// ═══════════════════════════════════════════════════════════════
// SEZIONE 3 — STATE MANAGER
// ═══════════════════════════════════════════════════════════════

/**
 * Controlla quali sezioni della pagina sono visibili.
 * Approccio "reset totale poi attiva": nasconde tutto prima
 * di mostrare solo ciò che serve, evitando stati sovrapposti.
 *
 * Usa l'attributo HTML5 nativo `hidden` — più semantico di
 * classList e compatibile con screen reader senza CSS aggiuntivo.
 *
 * @param {'idle' | 'loading' | 'error' | 'results'} state
 */
function showSection(state) {
  profileSection.hidden = true;
  matchesSection.hidden = true;
  loadingSection.hidden = true;
  errorSection.hidden   = true;

  if (state === 'loading') {
    loadingSection.hidden = false;
  } else if (state === 'error') {
    errorSection.hidden = false;
  } else if (state === 'results') {
    profileSection.hidden = false;
    matchesSection.hidden = false;
  }
  // 'idle': tutto rimane nascosto (stato di partenza)
}


// ═══════════════════════════════════════════════════════════════
// SEZIONE 4 — FUNZIONI API
// Una funzione per ogni endpoint: responsabilità singola,
// errori granulari, facili da testare o sostituire.
// ═══════════════════════════════════════════════════════════════

/**
 * Recupera PUUID e dati account tramite Riot ID.
 * Usa il continental endpoint account-v1 (via backend).
 *
 * @param {string} region   - Es. 'euw1'
 * @param {string} gameName - Nome prima del # nel Riot ID
 * @param {string} tagLine  - Stringa dopo il # (es. 'EUW', 'KR1')
 * @returns {Promise<{ puuid: string, gameName: string, tagLine: string }>}
 * @throws {Error} Se la risposta non è ok
 */
async function fetchAccount(region, gameName, tagLine) {
  const url = `${API_BASE_URL}/account/${region}/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Summoner non trovato (HTTP ${response.status})`);
  }

  return response.json();
}

/**
 * Recupera i dati summoner (icona, livello, id interno)
 * tramite PUUID. Usa il regional endpoint summoner-v4.
 *
 * @param {string} region - Es. 'euw1'
 * @param {string} puuid  - Identificatore universale Riot
 * @returns {Promise<{ id: string, profileIconId: number, summonerLevel: number }>}
 * @throws {Error} Se la risposta non è ok
 */
async function fetchSummoner(region, puuid) {
  const url = `${API_BASE_URL}/summoner/${region}/${encodeURIComponent(puuid)}`;
  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Errore recupero summoner (HTTP ${response.status})`);
  }

  return response.json();
}

/**
 * Recupera le entry ranked del summoner.
 * Usa il regional endpoint league-v4.
 * Può restituire array vuoto se il giocatore non è classificato.
 *
 * @param {string} region      - Es. 'euw1'
 * @param {string} summonerId  - ID interno criptato (summoner.id)
 * @returns {Promise<Array<{ queueType: string, tier: string, rank: string, leaguePoints: number, wins: number, losses: number }>>}
 * @throws {Error} Se la risposta non è ok
 */
async function fetchRank(region, summonerId) {
  const url = `${API_BASE_URL}/rank/${region}/${encodeURIComponent(summonerId)}`;
  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Errore recupero rank (HTTP ${response.status})`);
  }

  return response.json();
}

/**
 * Recupera gli ID delle ultime 10 partite del giocatore.
 * Usa il continental endpoint match-v5 (via backend).
 *
 * @param {string} region - Es. 'euw1'
 * @param {string} puuid  - Identificatore universale Riot
 * @returns {Promise<string[]>} Array di match ID (es. ['EUW1_1234567890'])
 * @throws {Error} Se la risposta non è ok
 */
async function fetchMatches(region, puuid) {
  const url = `${API_BASE_URL}/matches/${region}/${encodeURIComponent(puuid)}`;
  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Errore recupero partite (HTTP ${response.status})`);
  }

  return response.json();
}


// ═══════════════════════════════════════════════════════════════
// SEZIONE 5 — HELPER FUNCTIONS
// Funzioni pure: input → output, nessun side effect sul DOM.
// ═══════════════════════════════════════════════════════════════

/**
 * Converte una durata in secondi nel formato "mm:ss".
 * Usata per mostrare la durata delle partite.
 *
 * @param {number} seconds - Durata in secondi (es. 1830)
 * @returns {string} Es. "30:30"
 */
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Converte un timestamp Unix (millisecondi) in una stringa
 * relativa leggibile in italiano.
 *
 * @param {number} timestamp - Unix timestamp in ms
 * @returns {string} Es. "2 ore fa", "3 giorni fa", "poco fa"
 */
function timeAgo(timestamp) {
  const diffMs      = Date.now() - timestamp;
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours   = Math.floor(diffMs / 3600000);
  const diffDays    = Math.floor(diffMs / 86400000);

  if (diffMinutes < 1)  return 'poco fa';
  if (diffMinutes < 60) return `${diffMinutes} min fa`;
  if (diffHours   < 24) return `${diffHours} ${diffHours === 1 ? 'ora' : 'ore'} fa`;
  return `${diffDays} ${diffDays === 1 ? 'giorno' : 'giorni'} fa`;
}

/**
 * Restituisce una stringa colore CSS in base al ratio KDA.
 * I valori sono var() CSS — funzionano perché vengono assegnati
 * a style.color direttamente nel DOM, dove le custom properties
 * vengono risolte nel contesto del documento.
 *
 * @param {number} ratio - KDA calcolato ((K+A)/D)
 * @returns {string} Variabile CSS colore
 */
function kdaColor(ratio) {
  if (ratio < 1.5) return 'var(--loss-color)';   // sotto la media → rosso
  if (ratio < 3.0) return 'var(--text-primary)';  // nella norma → bianco
  if (ratio < 5.0) return 'var(--win-color)';     // buono → verde
  return 'var(--gold-light)';                      // eccezionale → oro
}

/**
 * Mappa i principali queueId di LoL in nomi leggibili.
 * I valori corrispondono ai queueId ufficiali Riot.
 *
 * @param {number} queueId - ID coda dalla risposta match-v5
 * @returns {string} Nome leggibile della modalità
 */
function getQueueName(queueId) {
  const queues = {
    420: 'Ranked Solo',
    440: 'Ranked Flex',
    450: 'ARAM',
    400: 'Normal Draft',
  };
  return queues[queueId] ?? 'Partita Personalizzata';
}


// ═══════════════════════════════════════════════════════════════
// SEZIONE 6 — RENDER FUNCTIONS
// Ricevono dati già pronti e aggiornano il DOM.
// Nessuna logica di fetch: separazione netta dato/vista.
// ═══════════════════════════════════════════════════════════════

/**
 * Popola la summoner card con icona, nome Riot ID e livello.
 * L'URL dell'icona segue la convenzione DataDragon:
 * /cdn/{version}/img/profileicon/{id}.png
 *
 * @param {{ gameName: string, tagLine: string }} accountData
 * @param {{ profileIconId: number, summonerLevel: number }} summonerData
 */
function renderSummoner(accountData, summonerData) {
  summonerIcon.src = `${DDRAGON_BASE}/cdn/${VERSION}/img/profileicon/${summonerData.profileIconId}.png`;
  summonerIcon.alt = `Icona di ${accountData.gameName}`;

  summonerName.textContent  = `${accountData.gameName}#${accountData.tagLine}`;
  summonerLevel.textContent = `Livello ${summonerData.summonerLevel}`;
}

/**
 * Popola la rank card con tier, LP e winrate Solo/Duo.
 * Se il giocatore non ha una entry RANKED_SOLO_5x5, mostra "Unranked".
 *
 * URL emblema DataDragon: /cdn/img/ranked-emblems/{TIER}.png
 * Il nome file è UPPERCASE (es. GOLD.png, PLATINUM.png).
 *
 * @param {Array<{ queueType: string, tier: string, rank: string, leaguePoints: number, wins: number, losses: number }>} rankData
 */
function renderRank(rankData) {
  const soloEntry = rankData.find(entry => entry.queueType === 'RANKED_SOLO_5x5');

  if (!soloEntry) {
    rankEmblem.hidden        = true;
    rankTier.textContent     = 'Unranked';
    rankLp.textContent       = '-';
    rankWinrate.textContent  = '-';
    return;
  }

  const { tier, rank, leaguePoints, wins, losses } = soloEntry;
  const tierUpper = tier.toUpperCase();

  rankEmblem.src    = `${DDRAGON_BASE}/cdn/img/ranked-emblems/${tierUpper}.png`;
  rankEmblem.alt    = `Emblema ${tierUpper}`;
  rankEmblem.hidden = false;

  rankTier.textContent = `${tierUpper} ${rank}`;
  rankLp.textContent   = `${leaguePoints} LP`;

  const total           = wins + losses;
  const pct             = ((wins / total) * 100).toFixed(1);
  rankWinrate.textContent = `${pct}% (${wins}V ${losses}S)`;
}

/**
 * Popola la lista partite con i match ID come placeholder.
 * Ogni <li> ha la struttura HTML attesa dal CSS (.match-card),
 * pronta per essere arricchita nella Fase 5 con i dati reali.
 *
 * @param {string[]} matchIds - Array di match ID
 */
function renderMatches(matchIds) {
  matchesList.innerHTML = '';

  if (matchIds.length === 0) {
    const emptyItem = document.createElement('li');
    emptyItem.className   = 'match-card';
    emptyItem.textContent = 'Nessuna partita trovata';
    matchesList.appendChild(emptyItem);
    return;
  }

  matchIds.forEach(matchId => {
    const li = document.createElement('li');
    li.dataset.matchId = matchId;

    // Struttura HTML coerente con le classi del CSS.
    // Il campo .match-duration mostra l'ID come riferimento visivo
    // temporaneo — verrà sostituito dai dati reali nella Fase 5.
    li.innerHTML = `
      <div class="match-card">
        <div class="match-result-col">
          <span class="match-result">-</span>
          <span class="match-mode">-</span>
          <span class="match-duration">ID: ${matchId}</span>
        </div>
      </div>
    `;

    matchesList.appendChild(li);
  });
}


// ═══════════════════════════════════════════════════════════════
// SEZIONE 7 — HANDLE SEARCH
// Orchestrazione: legge input → valida → chiama API in sequenza
// → renderizza → aggiorna stato. Un solo try/catch globale per
// propagare qualsiasi errore delle API verso l'error section.
// ═══════════════════════════════════════════════════════════════

/**
 * Gestisce il submit del form di ricerca.
 * Flusso API sequenziale (ogni step dipende dal precedente):
 *   fetchAccount → fetchSummoner → fetchRank + fetchMatches
 *
 * @param {SubmitEvent} event
 */
async function handleSearch(event) {
  event.preventDefault();

  const region   = regionSelect.value;
  const rawInput = summonerInput.value.trim();

  // Parsing Riot ID: splitta sull'ultimo '#' per gestire
  // gameName che contengono '#' (edge case raro ma possibile)
  const hashIndex = rawInput.lastIndexOf('#');
  const gameName  = hashIndex !== -1 ? rawInput.slice(0, hashIndex).trim()  : '';
  const tagLine   = hashIndex !== -1 ? rawInput.slice(hashIndex + 1).trim() : '';

  if (!gameName || !tagLine) {
    errorMessage.textContent = 'Formato non valido. Usa: NomeGiocatore#TAG (es. Faker#KR1)';
    showSection('error');
    return;
  }

  showSection('loading');

  try {
    // STEP 1 — Riot ID → PUUID (richiesto per tutti i passi successivi)
    const account = await fetchAccount(region, gameName, tagLine);

    // STEP 2 — PUUID → dati summoner (profileIconId, level, id interno)
    const summoner = await fetchSummoner(region, account.puuid);

    // STEP 3 — summoner.id → rank (l'id interno serve a league-v4, non il PUUID)
    const rank = await fetchRank(region, summoner.id);

    // STEP 4 — PUUID → lista match ID
    const matches = await fetchMatches(region, account.puuid);

    renderSummoner(account, summoner);
    renderRank(rank);
    renderMatches(matches);

    showSection('results');

  } catch (error) {
    errorMessage.textContent = error.message;
    showSection('error');
  }
}


// ═══════════════════════════════════════════════════════════════
// SEZIONE 8 — INIT
// ═══════════════════════════════════════════════════════════════

searchForm.addEventListener('submit', handleSearch);
showSection('idle');

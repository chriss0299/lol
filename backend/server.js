import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
// HELPER: routing regionale
// ─────────────────────────────────────────────
// Le API Riot si dividono in due categorie:
//
//  1. Regional endpoints  (es. euw1.api.riotgames.com)
//     → usati per dati specifici della region: summoner-v4, league-v4
//
//  2. Continental endpoints (es. europe.api.riotgames.com)
//     → usati per dati cross-region: account-v1, match-v5
//
// Questa mappa traduce la region scelta dall'utente nel
// corretto continental endpoint.
const ROUTING_MAP = {
  // Europa
  euw1: 'europe',
  eun1: 'europe',
  tr1:  'europe',
  ru:   'europe',
  // Americhe
  na1:  'americas',
  br1:  'americas',
  la1:  'americas',
  la2:  'americas',
  // Asia
  kr:   'asia',
  jp1:  'asia',
};

/**
 * Restituisce il continental routing per una region.
 * Default: 'europe' se la region non è mappata.
 */
function getRouting(region) {
  return ROUTING_MAP[region] ?? 'europe';
}

// ─────────────────────────────────────────────
// HELPER: chiamata autenticata alle API Riot
// ─────────────────────────────────────────────
// Centralizza header e gestione errori HTTP.
// Lancia un Error con .status per propagare il
// codice HTTP originale Riot al client.
async function riotFetch(url) {
  const res = await fetch(url, {
    headers: { 'X-Riot-Token': process.env.RIOT_API_KEY },
  });

  if (!res.ok) {
    // Riot restituisce { status: { message, status_code } } sugli errori
    const body = await res.json().catch(() => ({}));
    const error = new Error(body?.status?.message || `HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }

  return res.json();
}

// ─────────────────────────────────────────────
// GET /api/health
// ─────────────────────────────────────────────
// Rotta di controllo: verifica che il server sia
// attivo e che la API key sia configurata.
// Utile per healthcheck e debugging iniziale.
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    apiKeyConfigured: Boolean(process.env.RIOT_API_KEY),
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────
// ROTTA 1 — GET /api/account/:region/:gameName/:tagLine
// ─────────────────────────────────────────────
// Recupera il PUUID tramite il nuovo sistema Riot ID (gameName#tagLine).
//
// Usa il continental endpoint (account-v1) perché il Riot ID
// è globale e non legato a una singola region.
//
// Parametri path:
//   :region   → es. "euw1" — usato solo per ricavare il routing
//   :gameName → parte prima del # nel Riot ID
//   :tagLine  → parte dopo il # (es. "EUW", "KR1", "0001")
//
// Risposta: { puuid, gameName, tagLine }
app.get('/api/account/:region/:gameName/:tagLine', async (req, res) => {
  const { region, gameName, tagLine } = req.params;
  const routing = getRouting(region);

  // encodeURIComponent necessario: gameName può contenere
  // spazi, caratteri accentati o simboli speciali
  const url = `https://${routing}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;

  try {
    const data = await riotFetch(url);

    // Restituisce solo i campi necessari al frontend
    res.json({
      puuid:    data.puuid,
      gameName: data.gameName,
      tagLine:  data.tagLine,
    });

  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// ROTTA 2 — GET /api/summoner/:region/:puuid
// ─────────────────────────────────────────────
// Recupera i dati summoner (icona, livello, id interno)
// a partire dal PUUID ottenuto dalla ROTTA 1.
//
// Usa il regional endpoint (summoner-v4) perché i dati
// summoner sono specifici per ogni server (EUW ha un proprio
// account separato da NA per lo stesso Riot ID).
//
// Parametri path:
//   :region → es. "euw1" — usato direttamente come subdomain
//   :puuid  → identificatore universale Riot del giocatore
//
// Risposta: { id, accountId, profileIconId, summonerLevel, ... }
app.get('/api/summoner/:region/:puuid', async (req, res) => {
  const { region, puuid } = req.params;

  // Il puuid è un UUID standard (alfanumerico + trattini),
  // encodeURIComponent è comunque buona pratica difensiva
  const url = `https://${encodeURIComponent(region)}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`;

  try {
    const data = await riotFetch(url);

    res.json({
      id:             data.id,
      accountId:      data.accountId,
      puuid:          data.puuid,
      profileIconId:  data.profileIconId,
      summonerLevel:  data.summonerLevel,
    });

  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// ROTTA 3 — GET /api/rank/:region/:summonerId
// ─────────────────────────────────────────────
// Recupera le entry di ranked per un summoner.
// Può restituire più entry (es. Solo/Duo + Flex).
//
// Usa il regional endpoint (league-v4) perché il rank
// è specifico del server — un giocatore può avere rank
// diversi su EUW e NA.
//
// Parametri path:
//   :region     → es. "euw1"
//   :summonerId → id criptato del summoner (da ROTTA 2: data.id)
//
// Risposta: array di { queueType, tier, rank, leaguePoints, wins, losses, ... }
//   queueType: "RANKED_SOLO_5x5" | "RANKED_FLEX_SR"
app.get('/api/rank/:region/:summonerId', async (req, res) => {
  const { region, summonerId } = req.params;

  const url = `https://${encodeURIComponent(region)}.api.riotgames.com/lol/league/v4/entries/by-summoner/${encodeURIComponent(summonerId)}`;

  try {
    const data = await riotFetch(url);

    // Restituisce l'array completo: il frontend filtra per queueType
    res.json(data);

  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// ROTTA 4 — GET /api/matches/:region/:puuid
// ─────────────────────────────────────────────
// Recupera gli ID delle ultime 10 partite del giocatore.
//
// Usa il continental endpoint (match-v5) perché lo storico
// partite è memorizzato nei server continentali, non regionali.
//
// Parametri path:
//   :region → es. "euw1" — convertito in routing continentale
//   :puuid  → identificatore universale del giocatore
//
// Risposta: array di 10 match ID (es. ["EUW1_1234567890", ...])
// I dettagli di ogni match si ottengono con una chiamata separata
// a https://{routing}.api.riotgames.com/lol/match/v5/matches/{matchId}
app.get('/api/matches/:region/:puuid', async (req, res) => {
  const { region, puuid } = req.params;
  const routing = getRouting(region);

  const url = `https://${routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?count=10`;

  try {
    const data = await riotFetch(url);

    // Array di stringhe: ["EUW1_7123456789", "EUW1_7123456788", ...]
    res.json(data);

  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// ROTTA 5 — GET /api/match/:region/:matchId
// ─────────────────────────────────────────────
// Recupera i dettagli completi di una singola partita.
//
// Usa il continental endpoint (match-v5): i dati delle partite
// sono archiviati sui server continentali indipendentemente
// dalla region del server di gioco.
//
// Parametri path:
//   :region  → es. "euw1" — convertito in routing continentale
//   :matchId → es. "EUW1_7123456789" (da ROTTA 4)
//
// Risposta: oggetto match completo con metadata e info (participants, ecc.)
app.get('/api/match/:region/:matchId', async (req, res) => {
  const { region, matchId } = req.params;
  const routing = getRouting(region);

  const url = `https://${routing}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`;

  try {
    const data = await riotFetch(url);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// Avvio server
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server avviato su http://localhost:${PORT}`);
  console.log(`API key configurata: ${Boolean(process.env.RIOT_API_KEY)}`);
});

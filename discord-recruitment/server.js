const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.set("trust proxy", true);

const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h
const QUESTIONS_PER_ATTEMPT = 20;

// ---------------------------------------------------------------------------
// Stockage persistant simple (fichier JSON) pour les cooldowns par IP.
// Suffisant pour un site de recrutement communautaire ; pas une vraie BDD.
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "attempts.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
let attempts = {};
try {
  attempts = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch (e) {
  attempts = {};
}
function saveAttempts() {
  fs.writeFile(DATA_FILE, JSON.stringify(attempts, null, 2), () => {});
}

// Sessions actives en mémoire (le temps d'un questionnaire)
const sessions = new Map();

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

// ---------------------------------------------------------------------------
// Banque de questions — Modérateur Discord (connaissances générales)
// Les bonnes réponses ne quittent JAMAIS le serveur.
// ---------------------------------------------------------------------------
const QUESTION_BANK = [
  { id: 1, text: "Que signifie l'acronyme « ToS » dans le contexte de Discord ?", options: ["Terms of Service (Conditions d'utilisation)", "Type of Server", "Team of Staff", "Trust or Safety"], correct: 0 },
  { id: 2, text: "Quelle permission Discord permet de supprimer les messages d'autres membres ?", options: ["Manage Messages", "Manage Channels", "Manage Roles", "View Audit Log"], correct: 0 },
  { id: 3, text: "Quel est le rôle du « journal d'audit » (Audit Log) sur un serveur Discord ?", options: ["Il liste les membres en ligne", "Il enregistre les actions de modération et administratives", "Il affiche les statistiques du serveur", "Il gère les invitations"], correct: 1 },
  { id: 4, text: "Un membre insulte un autre membre dans un salon public. Quelle est la première action appropriée ?", options: ["Bannir immédiatement sans avertissement", "Ignorer, ce n'est pas grave", "Supprimer le message, avertir le membre et rappeler les règles", "Répondre par une insulte pour \"recadrer\""], correct: 2 },
  { id: 5, text: "Que signifie « raid » dans le contexte d'un serveur Discord ?", options: ["Un événement organisé par le staff", "Une attaque coordonnée de plusieurs comptes pour nuire au serveur", "Un jeu vidéo joué par les membres", "Une mise à jour de Discord"], correct: 1 },
  { id: 6, text: "Quelle fonctionnalité permet de limiter le nombre de messages qu'un membre peut envoyer par intervalle de temps ?", options: ["Mute intelligent", "Rate Guard", "Slowmode (mode lent)", "Cooldown Manager"], correct: 2 },
  { id: 7, text: "Un utilisateur partage les informations personnelles d'un autre membre sans son accord (doxxing). Que faire ?", options: ["Rien, ce n'est pas le rôle du modérateur", "Supprimer le contenu, sanctionner fermement et escalader si besoin", "Prévenir uniquement la personne concernée", "Attendre que la victime porte plainte elle-même"], correct: 1 },
  { id: 8, text: "Quelle est la différence entre « Kick » et « Ban » ?", options: ["Ce sont deux noms pour la même action", "Le kick expulse (le membre peut revenir avec une invitation), le ban est permanent sauf débannissement", "Le kick est plus sévère que le ban", "Le ban ne fonctionne que sur les bots"], correct: 1 },
  { id: 9, text: "Un membre propose de l'argent en MP à un modérateur pour fermer les yeux sur une infraction. Que doit-il faire ?", options: ["Accepter discrètement si le montant est intéressant", "Ignorer le message", "Négocier un montant plus élevé", "Refuser et signaler la tentative de corruption à l'équipe"], correct: 3 },
  { id: 10, text: "Que signifie le terme « escalade » en modération ?", options: ["Monter en grade rapidement", "Le fait qu'un conflit ou une sanction s'aggrave s'il n'est pas géré", "Une notification Discord", "Un rôle réservé aux administrateurs"], correct: 1 },
  { id: 11, text: "Pourquoi rester neutre et factuel dans un rapport de modération ?", options: ["Pour éviter les accusations de favoritisme et garder une trace fiable", "Ce n'est pas important", "Pour impressionner l'administration", "Uniquement pour respecter Discord"], correct: 0 },
  { id: 12, text: "Quelle permission est nécessaire pour créer et gérer les salons vocaux/textuels ?", options: ["Manage Emojis", "Manage Webhooks", "Manage Channels", "Manage Nicknames"], correct: 2 },
  { id: 13, text: "Un membre mineur affirme être harcelé en message privé par un autre membre. Quelle attitude adopter ?", options: ["Dire que Discord ne gère pas les MP, donc rien à faire", "Prendre la situation au sérieux, recueillir des preuves et agir/escalader", "Demander à la victime de régler ça seule", "Plaisanter sur la situation"], correct: 1 },
  { id: 14, text: "Que permet la fonctionnalité « AutoMod » de Discord ?", options: ["Bannir automatiquement tous les nouveaux membres", "Filtrer/bloquer automatiquement certains contenus selon des règles définies", "Créer des salons automatiquement", "Générer des invitations illimitées"], correct: 1 },
  { id: 15, text: "Deux modérateurs ne sont pas d'accord sur une sanction. Quelle est la meilleure approche ?", options: ["Chacun applique sa propre sanction", "En discuter en interne et trouver un consensus, ou demander l'avis d'un responsable", "Laisser le membre choisir sa sanction", "Ignorer le problème"], correct: 1 },
  { id: 16, text: "Qu'est-ce qu'un « webhook » dans le contexte de Discord ?", options: ["Un rôle spécial réservé aux bots", "Un moyen d'envoyer automatiquement des messages dans un salon depuis un service externe", "Une commande pour bannir un membre", "Un outil de vérification d'âge"], correct: 1 },
  { id: 17, text: "Un membre a un pseudo/avatar inapproprié. Quelle action est la plus adaptée en général ?", options: ["Ignorer car ce n'est pas un message", "Bannir immédiatement sans discussion", "Demander poliment de le changer, sanctionner en cas de refus ou récidive", "Changer son pseudo à sa place sans le prévenir"], correct: 2 },
  { id: 18, text: "Pourquoi est-il déconseillé d'utiliser ses pouvoirs de modérateur pour un conflit personnel ?", options: ["Ce n'est pas déconseillé", "Cela constitue un abus de pouvoir et nuit à la confiance envers l'équipe", "Discord l'interdit techniquement", "Cela ralentit le serveur"], correct: 1 },
  { id: 19, text: "Quel est l'intérêt principal de documenter les sanctions (avertissements, mutes, bans) ?", options: ["Aucun intérêt particulier", "Garder un historique pour suivre la récidive et justifier les décisions futures", "Faire du chiffre", "Publier un classement des membres sanctionnés"], correct: 1 },
  { id: 20, text: "Un nouveau membre pose une question déjà présente dans le règlement. Quelle attitude adopter ?", options: ["Le rabrouer pour ne pas avoir lu les règles", "Ignorer la question", "Répondre avec pédagogie et rediriger vers le règlement, sans condescendance", "Le sanctionner pour ne pas avoir cherché avant"], correct: 2 },
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function publicQuestion(q) {
  return { id: q.id, text: q.text, options: q.options };
}

async function sendWebhook(payload) {
  if (!WEBHOOK_URL) {
    console.warn("[webhook] DISCORD_WEBHOOK_URL non défini — résultat non envoyé:", payload);
    return;
  }
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[webhook] Discord a refusé le message — status ${res.status}: ${body}`);
    } else {
      console.log("[webhook] envoyé avec succès, status", res.status);
    }
  } catch (e) {
    console.error("[webhook] échec réseau lors de l'envoi:", e.message);
  }
}

function buildEmbed({ pseudo, discordId, position, score, total, statusLabel, color, ip, cheated }) {
  const fields = [
    { name: "Candidat", value: pseudo || "Inconnu", inline: true },
    { name: "ID Discord", value: discordId ? `\`${discordId}\`` : "Non renseigné", inline: true },
    { name: "Poste", value: position || "Modérateur", inline: true },
    { name: "Score", value: `${score} / ${total}`, inline: true },
    { name: "Résultat", value: statusLabel, inline: true },
    { name: "IP", value: `\`${ip}\``, inline: true },
  ];
  return {
    username: "Recrutement Discord",
    embeds: [
      {
        title: cheated ? "🚫 Questionnaire abandonné (triche détectée)" : "📋 Résultat de questionnaire",
        color,
        fields,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Routes API
// ---------------------------------------------------------------------------

app.get("/api/status", (req, res) => {
  const ip = getClientIp(req);
  const record = attempts[ip];
  const now = Date.now();
  if (record && record.cooldownUntil && record.cooldownUntil > now) {
    return res.json({ blocked: true, remainingMs: record.cooldownUntil - now, lastStatus: record.lastStatus });
  }
  return res.json({ blocked: false });
});

app.post("/api/start", (req, res) => {
  const ip = getClientIp(req);
  const now = Date.now();
  const record = attempts[ip];
  if (record && record.cooldownUntil && record.cooldownUntil > now) {
    return res.status(403).json({ error: "cooldown", remainingMs: record.cooldownUntil - now });
  }

  const { pseudo, discordId, position } = req.body || {};
  if (!pseudo || typeof pseudo !== "string" || pseudo.trim().length < 2) {
    return res.status(400).json({ error: "pseudo_required" });
  }

  const chosen = shuffle(QUESTION_BANK).slice(0, QUESTIONS_PER_ATTEMPT);
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    ip,
    pseudo: pseudo.trim().slice(0, 64),
    discordId: (discordId || "").trim().slice(0, 64),
    position: position || "Modérateur Discord",
    startedAt: now,
    questionIds: chosen.map((q) => q.id),
    submitted: false,
  });

  return res.json({
    sessionId,
    totalQuestions: chosen.length,
    questions: chosen.map(publicQuestion),
  });
});

app.post("/api/abandon", express.json(), async (req, res) => {
  const { sessionId } = req.body || {};
  const session = sessions.get(sessionId);
  if (!session || session.submitted) return res.status(200).end();
  session.submitted = true;

  const now = Date.now();
  attempts[session.ip] = { cooldownUntil: now + COOLDOWN_MS, lastStatus: "cheated" };
  saveAttempts();

  await sendWebhook(
    buildEmbed({
      pseudo: session.pseudo,
      discordId: session.discordId,
      position: session.position,
      score: 0,
      total: session.questionIds.length,
      statusLabel: "❌ Échec automatique — a quitté la fenêtre pendant le test",
      color: 0xed4245,
      ip: session.ip,
      cheated: true,
    })
  );

  sessions.delete(sessionId);
  res.status(200).end();
});

app.post("/api/submit", async (req, res) => {
  const { sessionId, answers } = req.body || {};
  const session = sessions.get(sessionId);
  if (!session) return res.status(400).json({ error: "invalid_session" });
  if (session.submitted) return res.status(400).json({ error: "already_submitted" });
  session.submitted = true;

  const total = session.questionIds.length;
  let score = 0;
  for (const qid of session.questionIds) {
    const q = QUESTION_BANK.find((x) => x.id === qid);
    const given = answers ? answers[qid] : undefined;
    if (q && given === q.correct) score++;
  }

  const passed = score > total / 2;
  const now = Date.now();

  if (passed) {
    attempts[session.ip] = { cooldownUntil: now + COOLDOWN_MS * 3650, lastStatus: "accepted" };
  } else {
    attempts[session.ip] = { cooldownUntil: now + COOLDOWN_MS, lastStatus: "rejected" };
  }
  saveAttempts();

  await sendWebhook(
    buildEmbed({
      pseudo: session.pseudo,
      discordId: session.discordId,
      position: session.position,
      score,
      total,
      statusLabel: passed ? "✅ Accepté" : "❌ Refusé (score insuffisant)",
      color: passed ? 0x57f287 : 0xed4245,
      ip: session.ip,
      cheated: false,
    })
  );

  sessions.delete(sessionId);
  res.json({ score, total, passed });
});

// Nettoyage périodique des sessions abandonnées sans fermeture propre (> 2h)
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.startedAt > 2 * 60 * 60 * 1000) sessions.delete(id);
  }
}, 15 * 60 * 1000);

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Serveur de recrutement lancé sur le port ${PORT}`);
  if (!WEBHOOK_URL) console.warn("⚠️  DISCORD_WEBHOOK_URL n'est pas défini — configure-le dans les variables d'environnement Railway.");
});

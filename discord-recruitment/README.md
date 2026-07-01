# Site de recrutement — Modérateur Discord

Site complet (front + back) pour recruter des modérateurs : la personne choisit le poste,
remplit son pseudo Discord, puis passe un questionnaire de 20 questions avec :

- une **barre de progression** style terminal (`[███░░░░] 45%`)
- un **anti-triche** : changer d'onglet, minimiser la fenêtre ou faire sortir la souris
  du site = échec immédiat, et interdiction de retenter avant **24h**
- un calcul de score **côté serveur** (les bonnes réponses ne sont jamais envoyées au
  navigateur, donc pas de triche possible en lisant le code source)
- un **webhook Discord** automatique à la fin de chaque tentative (réussite, échec, ou
  triche) avec le pseudo, l'ID Discord, le score, et le résultat

Le seuil de réussite est **strictement plus de la moitié** des bonnes réponses (11/20 minimum).

## Structure du projet

```
discord-recruitment/
├── server.js              # backend Express : questions, sessions, cooldown, webhook
├── package.json
├── .env.example            # variable d'environnement attendue
├── public/
│   ├── index.html          # page d'accueil / choix du poste
│   ├── questionnaire.html  # identité + quiz + résultat
│   ├── script.js           # logique client + anti-triche
│   └── style.css
└── data/attempts.json      # généré automatiquement (cooldowns par IP)
```

## 1. Mettre le projet sur GitHub

```bash
cd discord-recruitment
git init
git add .
git commit -m "Site de recrutement modérateur"
git branch -M main
git remote add origin https://github.com/TON_USER/TON_REPO.git
git push -u origin main
```

⚠️ Le fichier `.env` est ignoré par git (`.gitignore`) — **ton webhook Discord ne doit
jamais être commit sur GitHub**, c'est une URL sensible : n'importe qui qui la trouve
peut spammer ton salon Discord.

## 2. Déployer sur Railway

1. Sur [railway.app](https://railway.app), **New Project → Deploy from GitHub repo**,
   sélectionne ton repo.
2. Railway détecte automatiquement Node.js et exécute `npm install` puis `npm start`.
3. Va dans l'onglet **Variables** du service et ajoute :
   ```
   DISCORD_WEBHOOK_URL = https://discord.com/api/webhooks/....
   ```
   (c'est ici, et seulement ici, que ton vrai webhook doit être renseigné — jamais dans
   le code)
4. Dans **Settings → Networking**, clique sur **Generate Domain** pour obtenir une URL
   publique (`....up.railway.app`). Tu peux ensuite brancher un nom de domaine perso si
   tu en as un.

C'est tout — à chaque `git push`, Railway redéploie automatiquement.

## Fonctionnement de l'anti-triche

Dès que le quiz démarre, trois événements sont surveillés côté navigateur :
- `blur` de la fenêtre (changement d'onglet, alt-tab, minimisation)
- `visibilitychange` (l'onglet passe en arrière-plan)
- `mouseleave` avec la souris qui sort par le haut de la page (sortie du site)

Le premier qui se déclenche envoie immédiatement un signal au serveur
(`navigator.sendBeacon`, fiable même si la page se ferme), qui :
1. marque la tentative comme "triche" pour l'IP du candidat,
2. bloque toute nouvelle tentative pendant 24h,
3. envoie un webhook Discord signalant l'abandon.

## Ajouter d'autres postes ou modifier les questions

- **Postes** : liste `positions` en haut de `public/index.html`.
- **Questions** : tableau `QUESTION_BANK` dans `server.js` (le champ `correct` est
  l'index, dans `options`, de la bonne réponse — ce fichier ne part jamais au client).
  20 questions sont piochées aléatoirement à chaque tentative parmi celles disponibles ;
  tu peux en ajouter autant que tu veux, `QUESTIONS_PER_ATTEMPT` contrôle combien sont
  posées.

## Limite connue

Le cooldown de 24h est stocké dans un fichier JSON local (`data/attempts.json`), pas
dans une vraie base de données. Ça fonctionne très bien en usage normal, mais si Railway
redéploie le service (nouveau push), ce fichier est réinitialisé. Si tu veux un
cooldown inviolable même après redéploiement, il faudrait le brancher sur Firebase
(comme sur ton site SCP SITE 11) ou une petite base Postgres Railway — dis-le moi si tu
veux que je l'ajoute.

# WatchParty

> Deux comptes. Un film.

<p align="center">
  <img src="./assets/watchparty-hero.png" alt="Deux amis reliés par un film à regarder ensemble" width="100%" />
</p>

WatchParty est une expérience de découverte vidéo à deux : chacun connecte son compte Google, invite l’autre dans une partie, swipe des recommandations YouTube et lance une séance dès qu’un match est trouvé.

**[Voir la démo en ligne →](https://mignon-watch-party.moncefstiti007.chatgpt.site/)**

## Fonctionnalités

- Connexion Google avec le scope YouTube en lecture seule.
- Lecture des abonnements et vidéos aimées pour construire une pile de recommandations.
- Création ou rejointure d’une partie avec un code court.
- Swipe gauche pour passer, swipe droite pour garder.
- Détection des goûts communs et lancement automatique du match.
- Lecteur YouTube intégré avec lecture, pause, mute, seek et synchronisation.
- Synchronisation locale via `BroadcastChannel` et synchronisation distante via le service de rooms.
- Interface responsive, sans framework ni étape de compilation côté client.

## Stack

- HTML sémantique, CSS moderne et JavaScript vanilla.
- Google Identity Services pour OAuth.
- YouTube Data API v3 pour les données et YouTube IFrame API pour la lecture.
- Worker compatible Cloudflare pour l’API de rooms.
- D1/SQLite pour les salons, présences, décisions et événements du lecteur.

## Démarrage rapide

### Prérequis

- Un navigateur récent.
- Un client OAuth Google de type **Web application**.
- YouTube Data API v3 activée dans Google Cloud.
- Un serveur HTTP local pour servir les fichiers.

### Installation

```bash
git clone https://github.com/MoncefST/WatchParty.git
cd WatchParty
cp config.example.js config.js
```

Renseigne ensuite `config.js` :

```js
window.WATCHPARTY_CONFIG = {
  googleClientId: "TON_CLIENT_ID.apps.googleusercontent.com",
  youtubeApiKey: "TA_CLE_YOUTUBE_OPTIONNELLE",
};
```

Lance le front-end :

```bash
python3 -m http.server 4173
```

Ouvre [http://localhost:4173](http://localhost:4173).

Pour tester Google en local, ajoute `http://localhost:4173` dans **Google Cloud Console → APIs et services → Identifiants → Origines JavaScript autorisées**. Ajoute également l’URL de production avant de déployer.

## Utilisation

1. Clique sur **Se connecter avec Google** et autorise l’accès YouTube en lecture seule.
2. Depuis **Mon compte**, vérifie les statistiques et continue vers **Inviter**.
3. Crée une partie puis partage le code à ton amie, ou rejoins sa partie avec son code.
4. Swipez chacun sur vos vidéos. Une vidéo aimée par les deux comptes devient un match.
5. Regarde le match dans **Regarder**. Tu peux aussi coller directement un lien YouTube valide.

Le mode local fonctionne entre onglets du même navigateur grâce à `BroadcastChannel`. Pour deux appareils différents, le worker et la base D1 doivent être disponibles sur le domaine de production.

## Synchronisation des rooms

Le front-end appelle les routes suivantes :

| Méthode | Route | Rôle |
| --- | --- | --- |
| `POST` | `/api/rooms/:code/join` | Enregistrer un participant et récupérer l’état initial. |
| `POST` | `/api/rooms/:code/events` | Ajouter un événement `profile`, `decision` ou `watch`. |
| `GET` | `/api/rooms/:code/state?after=0` | Récupérer le salon et les événements depuis un curseur. |

Exemple de payload de rejointure :

```json
{
  "role": "host",
  "user": { "name": "Camille", "picture": "https://..." }
}
```

Exemple d’événement :

```json
{
  "participantId": "session-id",
  "type": "decision",
  "payload": { "role": "host", "videoId": "abc123", "decision": "like" }
}
```

Le worker utilise les tables `rooms` et `room_events`. Le schéma de départ se trouve dans `drizzle/0001_watchparty.sql` et le binding logique D1 est déclaré dans `.openai/hosting.json`.

## Mise en production

Le dépôt contient déjà la sortie déployable dans `dist/` : les fichiers statiques, le worker dans `dist/server/index.js`, le schéma D1 et la configuration d’hébergement.

### Avec Sites / Cloudflare

1. Conserve le binding `DB` défini dans `.openai/hosting.json`.
2. Crée ou rattache une base D1 au projet.
3. Applique la migration `drizzle/0001_watchparty.sql`.
4. Déploie la sortie `dist/` avec le worker et les assets statiques.
5. Renseigne `config.js` avec le Client ID Google autorisé pour le domaine HTTPS de production.
6. Vérifie les routes `/api/rooms/...` depuis deux navigateurs distincts.

### Hébergement statique uniquement

Netlify, Vercel, Cloudflare Pages ou GitHub Pages peuvent servir l’interface sans commande de build. Configure la racine du dépôt comme dossier publié et utilise HTTPS.

Un hébergement statique seul permet le parcours et le mode local, mais pas la synchronisation entre deux appareils. Pour cette dernière, garde le worker de rooms et la base D1 sur le même domaine ou configure un proxy vers ton backend.

## Configuration Google Cloud

1. Crée un **OAuth Client ID → Web application**.
2. Ajoute les origines locales et de production autorisées.
3. Active **YouTube Data API v3** dans le projet Google Cloud.
4. Déclare le scope `https://www.googleapis.com/auth/youtube.readonly`.
5. Si tu utilises une clé YouTube, restreins-la par domaine HTTP et par API.
6. Pendant les tests OAuth, ajoute les comptes autorisés dans la liste des utilisateurs de test.

WatchParty lit le profil, les abonnements et les vidéos aimées après consentement. Le feed personnel YouTube n’est pas exposé directement par l’API : les cartes sont construites à partir des signaux disponibles, sans inventer de données.

## Checklist avant ouverture publique

- Vérifier les erreurs de la console navigateur.
- Tester deux comptes Google dans deux navigateurs différents.
- Tester création, rejointure, match, lecture, pause et seek.
- Vérifier que D1 répond correctement et que les salons expirés sont nettoyés.
- Vérifier les quotas YouTube et le statut des utilisateurs de test OAuth.
- Utiliser HTTPS et ne jamais exposer de clé serveur dans `config.js`.
- Ajouter une limite de taille et une validation stricte sur les payloads d’événements.

## Structure du projet

```text
.
├── index.html
├── app.js
├── styles.css
├── config.js
├── config.example.js
├── assets/watchparty-hero.png
├── dist/
│   ├── client/          # assets servis par le worker
│   └── server/index.js  # API des rooms
├── drizzle/             # migrations D1
└── .openai/hosting.json # projet et binding D1
```

## Dépannage

- **« Ajoute ton Client ID Google dans config.js »** : le fichier est absent, vide ou contient encore la valeur d’exemple.
- **Google refuse l’accès** : vérifie l’origine autorisée, le compte de test et le scope YouTube.
- **Le profil fonctionne mais pas les recommandations** : active YouTube Data API v3 et vérifie la clé ou les quotas.
- **Le salon ne se synchronise pas entre appareils** : contrôle D1, les trois routes `/api/rooms/...` et le déploiement du worker.
- **Le lecteur reste vide** : vérifie que l’URL YouTube est valide et que l’iframe YouTube n’est pas bloquée par une extension.

## Licence

Ajoute la licence de ton choix avant une distribution publique. En l’absence de fichier `LICENSE`, le code reste protégé par le droit d’auteur et son usage externe n’est pas automatiquement autorisé.

# WatchParty

WatchParty est un parcours simple pour deux personnes : connexion Google, stats YouTube, code de partie, swipe, match et lecture YouTube synchronisée.

## Lancer en local

Ouvrir `index.html` dans un navigateur récent pour vérifier l’interface. Pour tester les appels de room, utiliser un serveur HTTP local afin que les fichiers `config.js` et les requêtes `/api` soient servis correctement.

## Activer Google + YouTube

1. Activer YouTube Data API v3 dans Google Cloud.
2. Créer un OAuth Client ID de type “Application Web” et ajouter l’origine du site dans les origines JavaScript autorisées.
3. Renseigner `googleClientId` dans `config.js` à partir de `config.example.js`.
4. Déclarer le scope `https://www.googleapis.com/auth/youtube.readonly` dans Google Auth Platform.

WatchParty lit le profil, les abonnements et les vidéos aimées après consentement. L’API YouTube ne fournit pas le feed d’accueil personnel directement : les cartes sont générées à partir des signaux disponibles, sans données inventées.

## Rooms

Le code de partie est partagé par URL. En production, les rooms utilisent le binding D1 déclaré dans `.openai/hosting.json` : les présences, décisions et commandes du lecteur passent par `/api/rooms/:code`.

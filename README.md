# WatchParty

WatchParty aide deux personnes à trouver une vidéo qui leur plaît à toutes les deux : connexion Google, radar de goûts, recommandations croisées, swipes individuels et match dans un Watchroom YouTube.

## Lancer

Ouvrir `index.html` dans un navigateur récent. Le mode aperçu est utilisable sans configuration. Les décisions de swipe et les commandes du lecteur peuvent se synchroniser entre deux onglets du même navigateur via `BroadcastChannel`.

## Activer Google + analyse YouTube

1. Dans Google Cloud Console, créer un projet et activer YouTube Data API v3.
2. Créer un identifiant OAuth 2.0 de type “Application Web”. Ajouter l’URL du site à ses origines JavaScript autorisées.
3. Copier `config.example.js` vers `config.js` et renseigner `googleClientId`.
4. Ajouter le scope `https://www.googleapis.com/auth/youtube.readonly` dans l’écran de consentement OAuth.
5. Ajouter une clé YouTube API restreinte au domaine dans `youtubeApiKey` si les appels publics doivent être utilisés.

Le site utilise Google Identity Services et lit uniquement le profil, les abonnements et les vidéos aimées après consentement. YouTube ne fournit pas un endpoint officiel “recommendations” utilisable directement par cette interface : WatchParty construit donc le radar et le mix à partir des signaux disponibles.

## Passage en production

Pour que deux personnes sur deux appareils différents partagent réellement leurs swipes et le même lecteur, remplacer le `BroadcastChannel` de `app.js` par un canal temps réel (WebSocket, Supabase Realtime ou Firebase) et conserver les tokens OAuth côté serveur.

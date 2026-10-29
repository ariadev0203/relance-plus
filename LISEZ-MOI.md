# Relance+ 1.0
Application PWA (Netlify) : recherche Veo Pro, sauvegarde des clients, alertes promotions, comparaison avec Veo Pro, suivi client, connexion sécurisée.

## Publier
1. Créer un dépôt GitHub « relance-plus » et y déposer tout le contenu de ce dossier (netlify.toml, package.json, dossiers `public` et `netlify` à la racine).
2. Sur Netlify : Add new site > Import from GitHub > choisir ce dépôt (aucun réglage à changer).
3. Facultatif : variable RELANCE_INVITE (Site configuration > Environment variables) pour exiger un code d'invitation à l'inscription.
4. Le premier compte créé devient administrateur.

## Première utilisation (sans Authenticator pour le moment)
Créer un compte (e-mail + mot de passe ; notez les codes de secours remis à l inscription) > Compte > renseigner l'identifiant Veo Pro > Accueil.
Les clients enregistrés sont conservés sur l'appareil (pas de synchronisation entre appareils).

## Version 1.2 : relance par message
- Relance > « À relancer » : bouton Relancer sur chaque client (aussi depuis sa fiche). Choix WhatsApp ou SMS, message préparé et modifiable avant l'envoi.
- Paramètres > Message de relance : canal par défaut, indicatif, signature et modèle du message (variables {salut} {civilite} {nom} {decodeur} {lieu} {expire} {moment} {signature} {formule} {fin} {abonne}). Délai « Relancer et prévenir » : 1 à 7 jours avant l'échéance.
- Après l'envoi, le client passe en « Relancé » jusqu'à ce que son échéance change.

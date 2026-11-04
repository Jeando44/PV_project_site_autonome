# Déploiement du site autonome sur Cloud Run

Le `.env` n'est **pas** envoyé dans l'image (`.dockerignore`) : en production, toutes les valeurs
sont des variables du service Cloud Run (ou des secrets Secret Manager exposés en variables).

## 1. Base Cloud SQL (MySQL), propre au site autonome

- Base dédiée, jamais celle de PV_project : `CREATE DATABASE <nom> CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
- Utilisateur avec tous les droits **sur cette base** (le démarrage crée les tables et applique les
  migrations : CREATE, ALTER, INDEX, REFERENCES, DROP...).
- Noter le **nom de connexion** de l'instance : `projet:region:instance`.

## 2. Service Cloud Run

- Source : dépôt GitHub `PV_project_site_autonome`, construction par le `Dockerfile`.
- **Connexions Cloud SQL** : ajouter l'instance (monte `/cloudsql/projet:region:instance`).
- Compte de service du service : rôle **Client Cloud SQL** (`roles/cloudsql.client`).
- Mémoire : 2 Gio conseillés (pvlib, pandas, matplotlib). Délai de requête : au moins 300 s.
- Adresse propre (`*.run.app` ou sous-domaine) : **jamais** sous `solakvan.com/concevoir_mon_projet`
  (cookie `__session` partagé avec PV_project).

## 3. Variables d'environnement du service

| Variable | Valeur en production |
|---|---|
| `DB_USER`, `DB_PASS`, `DB_NAME` | identifiants de la base du § 1 |
| `DB_HOST` | nom de connexion `projet:region:instance` (→ socket Unix, comme Solakvan) |
| `DATABASE_URL` | **ne pas définir** (elle passerait devant `DB_*`) |
| `FLASK_SECRET_KEY` | **propre** à cette application (différente de PV_project et de Solakvan) |
| `SSO_JWT_SECRET` | **identique** à celle de Solakvan |
| `MAIN_APP_URL` | adresse de production de Solakvan (`https://...`) |
| `APP_NAME` | `site_autonome` |
| `REQUIRED_PERMISSION` | `site_autonome` |
| `APPLICATION_EDITION` | `site_autonome` |
| `FLASK_ENV` | `production` (ou absente) |
| `SESSION_COOKIE_NAME` | `__session` (ou absente) |
| `SESSION_COOKIE_INSECURE` | **ne pas définir** |
| `PORT` | **ne pas définir** (réservée, Cloud Run la fournit) |
| `RECAPTCHA_PUBLIC_KEY`, `RECAPTCHA_PRIVATE_KEY` | clés reCAPTCHA (domaine du service autorisé dans la console reCAPTCHA) |
| `RECAPTCHA_VERIFY_URL` | `https://www.google.com/recaptcha/api/siteverify` |
| `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_DEFAULT_SENDER`, `MAIL_RECIPIENT`, `ADMIN_EMAIL` | messagerie |
| `GOOGLE_MAP_KEY` | clé Google Maps (adresse du service ajoutée aux référents autorisés) |
| `MATERIELS_ADMIN_EMAILS` | adresse(s) autorisée(s) à administrer le catalogue (sinon personne en production) |
| `PROXYS_DE_CONFIANCE` | `1` si le service est appelé directement en `*.run.app` ; laisser `2` (défaut) derrière Firebase Hosting |
| `SSO_AUDIENCES_SUPPLEMENTAIRES` | vide |
| `SWITCHGRID_*`, `TEST_DATABASE_URL` | inutiles (Enedis masqué en site autonome) |

## 4. Premier démarrage

`entrypoint.sh` lance `flask preparer-base` (schéma complet + migrations, sous verrou MySQL) puis
gunicorn. En cas d'échec, le conteneur s'arrête : lire les journaux (`[entrypoint]`).

## 5. Catalogue de matériel

La base neuve n'a ni panneaux, ni onduleurs, ni batteries, ni pompes. Une fois le service démarré
une fois, depuis le poste (accès à l'instance par Cloud SQL Auth Proxy, par exemple) :

```
set CIBLE_DATABASE_URL=mysql+pymysql://UTILISATEUR:MOT_DE_PASSE@127.0.0.1:3306/NOM_BASE?charset=utf8mb4
Skvenv313\Scripts\python.exe scripts\copier_catalogue_materiel.py           (contrôle)
Skvenv313\Scripts\python.exe scripts\copier_catalogue_materiel.py --ecrire  (copie)
```

## 6. Côté Solakvan

- Branche `decoupage_app` déployée (quota `licence_pv` par permission).
- Admin > Applications : ligne `site_autonome` (modifier l'ancienne si elle existe), URL =
  adresse du service + `/concevoir_mon_projet/`, permission `site_autonome`.
- Donner la permission `site_autonome` aux utilisateurs concernés.

## 7. Contrôle

Clic sur le bouton Solakvan → arrivée sur le site autonome connecté ; créer un projet Habitation,
l'enregistrer, le rouvrir ; vérifier que les catalogues (panneaux, batteries, pompes) s'affichent.

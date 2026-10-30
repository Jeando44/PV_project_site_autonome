# PV_project_site_autonome

Application « Site autonome » (Habitation, Système hybride, Pompage solaire), copie de PV_project
avec sa propre base de données et sa propre permission Solakvan (`site_autonome`).

Seules différences avec PV_project (à conserver pour pouvoir reporter les corrections par simple
copie) : `EDITION_PAR_DEFAUT` dans `app/utils/parcours.py` et la configuration (`.env.example`).
Voir `docs/decoupage_editions_plan.md`.

Démarrage local : créer `.env` depuis `.env.example`, créer la base, puis
`python -m flask preparer-base` et `python app.py`.

# La copie de fluidplan de Mateo

Copie de [morganhub/fluidplan](https://github.com/morganhub/fluidplan), partie du commit audité
`755d1b2` (26/09/2026). Ticket : Elducos56/aios-meta#243. Plan décidé : `.fluidplan/adapter-mateo/`
(PLAN.md, DECISIONS.md). Ce fichier vit dans `docs/` et non à la racine (ADR 0033).

## Ce qui change par rapport à l'original

| Changement | Décision | Fichiers |
|---|---|---|
| Français par défaut, interface au tutoiement, « Modifier » devient « Changer » | B1 | `engine/lib/config.mjs`, `engine/templates/plan.json`, `engine/public/i18n/fr.json` |
| 4 cartes non mineures au plus par page avant avertissement (6 avant) | A2 | `engine/lib/validate.mjs`, `SKILL.md`, `references/authoring.md` |
| Claude écrit avec le style actif de la session ; deux avertissements neutres : proposition de plus de 4 phrases, phrase de plus de 30 mots | B2 | `engine/lib/validate.mjs`, `references/pedagogy.md` |
| Avertissement si le glossaire définit un mot déjà connu (dépôt, ticket, ADR…) | M2 | `engine/lib/validate.mjs` |
| « Expliquer » : deux phrases sans terme technique, plus un schéma quand il aide ; un visuel par défaut sur chaque carte importante, avertissement sinon | B3 | `SKILL.md`, `references/*.md`, `engine/lib/validate.mjs` |
| Bouton « Tout comme recommandé » (sauf cartes critiques) | A1 | `engine/public/js/store.js`, `engine/public/js/layout.js`, `engine/public/i18n/*.json` |
| Durée de lecture par carte et temps restant | A3 | `engine/public/js/model.js`, `decision.js`, `layout.js` |
| Touches 1 à 4 (OK, Pas OK, Changer, Expliquer) et N (prochaine carte sans réponse) | M1 | `engine/public/js/layout.js` |
| Bandeau « Reprendre » : la dernière carte touchée, les cartes restantes, la durée | D1 | `engine/public/js/layout.js` |
| Après `finalize`, Claude propose (jamais d'office) de déposer DECISIONS.md dans `0-inbox/` du cerveau DEG par gbrain `capture` | C1 | `SKILL.md`, `references/execution-plan.md` |
| Plans dans `docs/fluidplan/<id>/` ; un projet qui a déjà `.fluidplan/` le garde ; `new` exclut de git les fichiers de réponses | C2 | `engine/lib/config.mjs`, `engine/fluidplan.mjs` |
| Une seule « Suite : » sur la page de synthèse | M3 | `engine/public/js/summary.js` |
| `serve --tailscale` : écoute aussi sur l'adresse Tailscale (100.x), désactivé par défaut | D3 | `engine/server.mjs`, `engine/lib/tailscale.mjs`, `engine/fluidplan.mjs` |
| Script d'installation figée | E2 | `scripts/installer-mateo.ps1` |

Pas de dictée développée (D2) : Wispr Flow suffit.

## Illustrations payantes : inertes

Pas de fichier `engine/.env`, donc aucune illustration et aucun appel réseau (M4).

Écart ajouté à l'exécution : une clé présente dans l'environnement de la machine (par exemple
`OPENAI_API_KEY`, posée pour un autre outil) n'active plus les illustrations. Il faut soit une clé
dans `engine/.env`, soit `FLUIDPLAN_IMAGES_FROM_ENV=1`. Sans ce garde-fou, le bouton
« Illustrer » aurait été actif sur ce poste, et chaque clic aurait coûté des crédits OpenAI.

## Mettre à jour depuis l'original

```
git remote add upstream https://github.com/morganhub/fluidplan.git
git fetch upstream
git diff 755d1b2 upstream/main
```

Relire le diff (audit), fusionner, lancer `npm test`, puis réinstaller avec
`pwsh scripts/installer-mateo.ps1`.

## Revenir à l'original

L'installation d'origine est archivée dans `C:\Users\mateo\Archives\fluidplan-origine-755d1b2\`.
Pour revenir : déplacer `C:\Users\mateo\.claude\skills\fluidplan` ailleurs, puis remettre le
dossier archivé à sa place, sous le nom `fluidplan`.

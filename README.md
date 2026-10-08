# Encyclopedia Galactica

## Ajouter une page
1. Copie `_modele.md` vers `pages/mon-slug.md` (minuscules, tirets, pas d'accents).
2. Ajoute `"mon-slug"` à la liste dans `pages/index.json`.
3. Commit/push : GitHub Pages met le site à jour.

## Syntaxe
- Lien interne : `[[slug]]` ou `[[slug|texte affiché]]` (marche aussi avec le titre ou un alias). Un lien vers une page inexistante s'affiche en rouge : c'est ta liste de pages à écrire.
- Citation : `{3}` renvoie à la 3e entrée de `sources:`.
- Infobox : bloc `info:` du front matter. Sommaire, pages liées et catégories sont automatiques.
- Images : dépose-les dans `images/` et mets `image: images/fichier.jpg`.

## Tester en local
`python -m http.server` dans ce dossier, puis ouvre http://localhost:8000
(les pages ne se chargent pas en double-cliquant sur index.html).

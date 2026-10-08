# Encyclopedia Galactica

## Mise en ligne sur GitHub Pages
- Tous les fichiers de ce dossier (y compris le fichier vide **`.nojekyll`**) doivent être à la **racine** du dépôt.
- Sans `.nojekyll`, GitHub Pages transforme les `.md` et le site reste vide.
- Settings → Pages → « Deploy from a branch » → branche `main`, dossier `/ (root)`.

## Ajouter / modifier une page
- **Depuis le site** : onglet « Modifier » (ou « Nouvelle page »). Pour enregistrer, colle un jeton GitHub (voir l'écran d'édition). Chaque enregistrement est un commit ; l'onglet « Historique » les liste.
- **À la main** : copie `_modele.md` vers `pages/mon-slug.md` et ajoute `"mon-slug"` dans `pages/index.json`.

## Syntaxe
- Lien : `[[slug]]`, `[[slug|texte]]`, `[[slug#section|texte]]`. Lien rouge = page à créer.
- Citation : `{3}` renvoie à la 3e entrée de `sources:`.
- Image n'importe où : `[[Fichier:nom.jpg|droite|300px|Légende]]` (voir GUIDE_IA.md pour toutes les options).
- Infobox : bloc `info:`. Anecdotes de l'accueil : liste `facts:`. Article à la une : `featured: true`.
- Images : dans le dossier `images/`.

## Tester en local
`python -m http.server` dans ce dossier, puis http://localhost:8000

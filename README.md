# ZRM — Assistant documentaire local, 100% offline

ZRM est un assistant qui tourne entièrement sur ta machine : tu déposes tes fichiers dans `data/`,
il les indexe, et tu peux discuter avec eux. Aucun cloud, aucune donnée qui sort de ton PC.

---

## Ce qu'il fait

- **Ingestion multi-format** du dossier `data/` (récursif) :
  - Texte : `.txt`, `.md`, `.markdown`, `.log`
  - Structuré : `.json`, `.jsonl`, `.csv`, `.tsv`
  - Documents : `.pdf`
  - Bases : `.sqlite`, `.sqlite3`, `.db` (via `node:sqlite`)
- **Recherche hybride** BM25 (mots exacts) + **embeddings sémantiques** locaux : « combien gagne
  Enzo » retrouve le salaire, « prix du casque » retrouve la bonne ligne même sans mot commun.
- **Deux modes de réponse** :
  - **Rapide** — recherche instantanée, réponse extractive avec passages et sources (fiable et précis)
  - **Discussion** — un petit LLM local (Qwen2.5 0.5B ou 1.5B) rédige la réponse à partir de tes
    documents, en streaming
- **Artifacts dans le chat** : le modèle peut produire du **HTML** (rendu dans une iframe sandboxée,
  plein écran ou nouvel onglet) et des **graphiques** (barres, lignes, camembert) générés depuis tes
  CSV/SQLite.
- **Visualiseur de documents** : chaque source ouvre une page dédiée (tableaux pour CSV/SQLite, PDF
  embarqué, texte/JSON/Markdown formatés, téléchargement).
- **Import dans le chat** : bouton `+`, glisser-déposer, ou tiroir Documents.
- **Recherche insensible aux accents et aux pluriels**, avec suppression des stopwords FR/EN.

> Deux modèles sont téléchargés une seule fois dans `.models/` : les embeddings
> (`multilingual-e5-small`, ~130 Mo) et le LLM (`qwen2.5-0.5b` ou `1.5b`, ~470 Mo / ~1 Go).
> Ensuite, tout fonctionne hors ligne.

---

## Démarrage

```bash
npm install
npm run model:download   # télécharge les modèles locaux (~470 Mo + ~1 Go, une seule fois)
npm run web              # interface web (http://127.0.0.1:5178)
npm start                # chat interactif en terminal
```

Premier lancement : ZRM crée le dossier `data/`. Dépose tes documents dedans, puis indexe.

### Interface web

```bash
npm run web
```

Ouvre **http://127.0.0.1:5178**. L'interface est un chat plein écran inspiré de ChatGPT (sidebar,
conversations, composer) dans un thème sombre avec l'accent bleu de ZRM :

- **Chat direct** : on arrive directement sur la conversation, pas de page d'accueil
- **Deux modes** (bascule au-dessus du composer) :
  - **Rapide** — réponse instantanée, extraite des documents (mode par défaut)
  - **Discussion** — le LLM local rédige, en streaming. Choisis 0.5B (plus rapide) ou 1.5B (meilleur)
- **Artifacts** : blocs HTML rendus dans une iframe sandboxée (boutons *Plein écran* et *Nouvel
  onglet*) et graphiques barres/lignes/camembert générés depuis tes données
- **Import de documents** : bouton `+`, glisser-déposer, ou tiroir **Documents** — enregistré et
  indexé automatiquement
- **Visualiseur** : clique sur une source pour ouvrir la page du document (tableau, PDF, code,
  téléchargement)
- **Tiroir Documents** : liste des fichiers, taille, statut indexé, suppression
- **Conversations** : historique local (navigateur) dans la sidebar

Le port se change avec la variable d'environnement `PORT`.

### Modèles locaux

```bash
npm run model:download            # les deux modèles
npm run model:download fast       # 0.5B seulement (~470 Mo)
npm run model:download quality    # 1.5B seulement (~1 Go)
```

Les fichiers vont dans `.models/`. Ils sont téléchargés depuis HuggingFace, une seule fois.

### Serveur LLM distant (VPS)

Si ton PC est lent, fais tourner le modèle sur un serveur plus puissant. ZRM garde l'index et tes
documents en local ; seul le LLM tourne à distance.

**1. Sur le serveur** (Ubuntu, 4 cœurs / 8 Go suffisent) :

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:3b     # ~2 Go — 10 tok/s sur un EPYC 4 cœurs
ollama pull qwen2.5:7b     # ~4,7 Go — 4,5 tok/s, meilleure qualité
```

Ollama écoute sur `127.0.0.1:11434` par défaut : rien n'est exposé publiquement.

**2. Sur ta machine**, ouvre un tunnel SSH :

```powershell
.\scripts\tunnel.ps1 -VpsHost TON_IP
# ou
ssh -N -L 11434:127.0.0.1:11434 root@TON_IP
```

Laisse cette fenêtre ouverte. Le tunnel expose le serveur distant sur `http://127.0.0.1:11434`.

**3. Dans ZRM**, clique sur l'icône ⚙ à côté du sélecteur de modèle, vérifie l'URL
(`http://127.0.0.1:11434`), clique **Tester la connexion** puis **Enregistrer**. Les modèles
distants apparaissent dans la liste.

La configuration est stockée dans `zrm.config.json` (ignoré par git). Elle peut aussi être définie
par variables d'environnement :

| Variable | Rôle |
| :--- | :--- |
| `ZRM_PROVIDER` | `auto`, `local` ou `remote` |
| `ZRM_REMOTE_URL` | URL du serveur (ex. `http://127.0.0.1:11434`) |
| `ZRM_REMOTE_KEY` | Clé API si le serveur en demande une |
| `ZRM_REMOTE_MODEL` | Modèle par défaut |

Ça fonctionne avec **Ollama**, **llama.cpp server**, **vLLM**, **LM Studio** et toute API
**compatible OpenAI** (OpenRouter, Groq, OpenAI…).

### Modes rapides (sans interaction)

```bash
node src/cli.js --ingest                 # (re)construit l'index de data/
node src/cli.js --ask "ta question"      # ingère au besoin, puis répond une seule fois
```

### API HTTP (utilisée par le web)

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/stats` | État de l'index, passages, documents, sources |
| `GET` | `/api/models` | Modèles locaux + distants détectés |
| `POST` | `/api/models/warmup` | Précharge un modèle (`{ provider, model }`) |
| `GET` | `/api/config` | Configuration courante |
| `POST` | `/api/config` | Enregistre la configuration |
| `POST` | `/api/remote/test` | Teste la connexion au serveur distant |
| `POST` | `/api/chat` | Chat en **SSE** : `{ question, mode, provider, model, history }` |
| `POST` | `/api/chart` | Construit un graphique depuis `data/` |
| `GET` | `/api/documents` | Liste des fichiers de `data/` (taille, statut indexé) |
| `POST` | `/api/documents/upload` | Enregistre un fichier (en-tête `x-filename`) |
| `DELETE` | `/api/documents/:nom` | Supprime un fichier de `data/` |
| `POST` | `/api/ingest` | (Ré)indexe le dossier `data/` |
| `GET` | `/doc/:nom` | Page du visualiseur de document |
| `GET` | `/raw/:nom` | Fichier brut (téléchargement, PDF) |

---

## Commandes du chat

| Commande | Effet |
| :--- | :--- |
| `(texte)` | Pose une question sur tes données |
| `/ingest` | (Re)indexe tout le dossier `data/` |
| `/ask <question>` | Répond sans quitter le shell |
| `/stats` | Passages, documents, termes, répartition par type |
| `/sources` | Liste les documents indexés et leur nombre de passages |
| `/help` | Aide |
| `/quit` | Quitter |

---

## Comment ça marche

```
data/ ──▶ scanner ──▶ parser (txt/md/json/csv/pdf/sqlite)
                        │
                        ▼
                    chunker (par enregistrement pour sqlite/csv,
                             par paragraphe + chevauchement sinon)
                        │
                        ▼
        ┌───────────────┴───────────────┐
        ▼                               ▼
  index BM25 (mots)            embeddings sémantiques (sens)
        └───────────────┬───────────────┘
                        ▼
   question ──▶ recherche hybride ──┬──▶ mode Rapide : synthèse extractive
                                    │
                                    └──▶ mode Discussion : LLM local (Qwen2.5)
                                              │
                                              ▼
                                  réponse rédigée + sources + artifacts
                                  (HTML rendu, graphiques depuis les données)
```

La fusion est **adaptative** : quand la question contient un mot rare présent dans un document
(BM25 fort), l'index mots pèse plus lourd ; sinon, la recherche sémantique prend le relais pour
retrouver les passages par le sens.

L'index (mots + vecteurs) est persisté dans `.zrm/index.json`. Il est rechargé au démarrage ; relance
l'indexation (bouton **Indexer**, `/ingest` ou `node src/cli.js --ingest`) après avoir ajouté ou
modifié des fichiers dans `data/`.

---

## Architecture du code

```
src/
  cli.js                     boucle interactive + modes --ingest / --ask
  server.js                  serveur HTTP + API + SSE + routes web
  viewer.js                  pages du visualiseur de documents
  config.js                  constantes (chemins, tailles, paramètres BM25)
  ingest/
    scanner.js               parcours data/ + dispatch par extension
    chunker.js               découpage en passages
    parsers/
      text.js                txt/md/log
      json.js                json/jsonl (aplati en lignes indexables)
      csv.js                 csv/tsv (en-têtes + lignes)
      pdf.js                 pdf-parse
      sqlite.js              node:sqlite (tables -> lignes de texte)
  index/
    tokenizer.js             normalisation, accents, stopwords
    bm25.js                  index mots (tf, df, idf, avgdl) + recherche
    embeddings.js            chargement du modèle + calcul des vecteurs (e5)
    semantic.js              recherche par similarité cosinus
    search.js                fusion hybride adaptative (BM25 + sémantique)
    store.js                 persistance (mots + vecteurs) et statistiques
  answer/
    synthesizer.js           réponse extractive + citations + surlignage
  llm/
    engine.js                chargement du modèle GGUF local, sessions, streaming
    remote.js                client OpenAI-compatible (Ollama, vLLM, LM Studio…)
    router.js                choix local/distant + repli automatique
    system.js                prompt système partagé
    prompt.js                construction du contexte RAG
  charts/
    builder.js               détection d'intention + graphiques depuis CSV/SQLite
scripts/
  download-models.js         téléchargement des modèles GGUF
  tunnel.ps1                 tunnel SSH vers un serveur LLM distant
web/
  index.html                 chat plein écran (sidebar, messages, composer, tiroir)
  style.css                  thème sombre type ChatGPT + accent bleu ZRM
  app.js                     chat SSE, import de fichiers, artifacts, conversations
  chart.js                   rendu SVG des graphiques (barres, lignes, camembert)
```

---

## Prérequis

- **Node.js >= 22** (pour `node:sqlite`). Le support SQLite est expérimental côté Node : un
  avertissement peut s'afficher, il est sans gravité.
- Les PDF nécessitent la dépendance `pdf-parse` (incluse dans `package.json`).
- Les modèles (embeddings ~130 Mo + LLM ~470 Mo/1 Go) sont téléchargés une seule fois dans
  `.models/`. Ensuite, tout est hors ligne.

---

## Performances du mode Discussion

Le mode **Discussion** fait tourner un LLM sur un CPU. Mesures réelles :

| Machine | Modèle | Vitesse | 1er token |
| :--- | :--- | :--- | :--- |
| i5-7200U (2 cœurs, 8 Go) | Qwen2.5 0.5B/1.5B | ~1 mot/s | 4-30 s |
| VPS EPYC (4 cœurs, 8 Go) | Qwen2.5 3B | **~10 tok/s** | ~2 s |
| VPS EPYC (4 cœurs, 8 Go) | Qwen2.5 7B | ~4,5 tok/s | ~5 s |

Le mode **Rapide** reste instantané (quelques millisecondes) et plus fiable pour retrouver une
information précise. Utilise-le par défaut, et bascule en **Discussion** quand tu veux une réponse
rédigée ou une conversation.

**Recommandation** : si ton PC est modeste, fais tourner le LLM sur un VPS (voir plus haut). ZRM
reste local, seul le modèle est distant.

---

## Sécurité

- **Rien n'est exposé publiquement par défaut.** Le serveur ZRM écoute sur `127.0.0.1:5178` et
  Ollama sur `127.0.0.1:11434`. Aucun port n'est ouvert sur Internet.
- **Tunnel SSH recommandé** pour joindre un serveur distant : le trafic est chiffré et le port du
  LLM n'est jamais exposé.
- **Clés SSH plutôt que mots de passe** : `scripts/tunnel.ps1` utilise la clé
  `~/.ssh/zrm_vps`. Ajoute ta clé publique sur le serveur avec
  `ssh-copy-id` (ou manuellement dans `~/.ssh/authorized_keys`) puis **désactive
  l'authentification par mot de passe** (`PasswordAuthentication no` dans `/etc/ssh/sshd_config`).
- **Clé API** : si tu passes par une API cloud compatible OpenAI, mets la clé dans `zrm.config.json`
  (ignoré par git) ou dans `ZRM_REMOTE_KEY`. Elle n'est jamais renvoyée au navigateur (affichée
  comme `***`).

---

## Limites assumées

- Le mode **Rapide** n'est pas un LLM : il ne rédige pas, il restitue les passages pertinents. Très
  fiable pour retrouver une info, incapable d'inventer ou de synthétiser.
- Le mode **Discussion** peut se tromper (petit modèle) : vérifie les informations importantes.
- Si l'information n'est pas présente dans `data/`, aucune méthode ne peut la trouver.
- Les bases SQLite sont lues en lecture seule, plafonnées à 5000 lignes par table.
- Les fichiers > 25 Mo, les extensions non listées et les fichiers vides sont ignorés.
- Les graphiques nécessitent des colonnes numériques dans un CSV ou une table SQLite.

---

## Différences avec ZRM v1

La v1 était un routeur d'actions système (killer un port, créer un fichier) basé sur un petit
réseau TensorFlow.js. La v2 repart sur une base propre centrée sur le **chat documentaire local**.
Les fichiers `main.js` et `dataset.json` de la v1 sont conservés à la racine pour référence.

import fs from "fs";
import { exec } from "child_process";
import os from "os";
import * as tf from "@tensorflow/tfjs";
import * as p from "@clack/prompts";
import yocto from "yoctocolors";

// Initialisations globales et Tokenizer Maison (Zéro dépendance, compatible Bun)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tokenizer = {
  tokenize(text) {
    return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  },
};

let dataset;
let labels;
let trainingData;
let responses;
let actions;
let modelName;
let msgPrefix;
let sysRules;
let vocabulary = [];
let trainingInputs = [];
let trainingOutputs = [];
let model = null;
let currentDatasetPath = "./dataset.json";

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const remainingMs = Math.round(ms % 1000);
  if (totalSeconds < 1) return `${remainingMs}ms`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 1) return `${seconds}s ${remainingMs}ms`;
  return `${minutes}min ${seconds}s`;
}

// --- MOTEUR DE DIAGNOSTIC ET CLARIFICATION DES ERREURS ---
function formaterErreur(error, contexte = "") {
  const msg = error?.message || String(error);
  const cleanContext = contexte ? yocto.dim(`\n🔍 Contexte : ${contexte}`) : "";

  // 1. Détection de commande inexistante (Windows CMD / PowerShell / Unix)
  if (
    msg.includes("is not recognized as an internal or external command") ||
    msg.includes("command not found") ||
    msg.includes("not found") ||
    msg.includes("cannot find the path")
  ) {
    let cmdInconnue = "demandée";
    const matchWin = msg.match(/'([^']+)'/);
    const matchUnix = msg.match(/(?:^|\s)(\S+):\s+not\s+found/);
    if (matchWin) cmdInconnue = matchWin[1];
    else if (matchUnix) cmdInconnue = matchUnix[1];

    return (
      yocto.red(
        `[COMMANDE INTROUVABLE] Le système ne connaît pas l'outil '${cmdInconnue}'.`,
      ) +
      yocto.yellow(
        `\n💡 Résolution :\n` +
          `  • Vérifiez l'orthographe de '${cmdInconnue}'.\n` +
          `  • Assurez-vous que le programme est installé sur votre ordinateur.\n` +
          `  • Vérifiez que son chemin est configuré dans vos variables d'environnement (PATH).`,
      ) +
      cleanContext
    );
  }

  // 2. Erreurs d'accès / Permissions d'écriture (FS ou Processus)
  if (
    msg.includes("EACCES") ||
    msg.includes("EPERM") ||
    msg.includes("Access is denied")
  ) {
    return (
      yocto.red(
        `[ACCÈS REFUSÉ] Privilèges insuffisants pour exécuter cette opération.`,
      ) +
      yocto.yellow(
        `\n💡 Résolution :\n` +
          `  • Relancez votre terminal en mode "Administrateur" (Windows) ou utilisez 'sudo' (Unix).`,
      ) +
      cleanContext
    );
  }

  // 3. Fichier ou dossier introuvable (Opérations de fichiers)
  if (msg.includes("ENOENT")) {
    return (
      yocto.red(`[CHEMIN INVALIDE] Le fichier ou dossier cible n'existe pas.`) +
      yocto.yellow(
        `\n💡 Résolution :\n` +
          `  • Vérifiez l'existence et l'orthographe du fichier ou du dossier spécifié.\n` +
          `  • Utilisez un chemin absolu ou relatif valide depuis le dossier actuel.`,
      ) +
      cleanContext
    );
  }

  // 4. Dossier ou fichier déjà existant (Création ou renommage)
  if (msg.includes("EEXIST")) {
    return (
      yocto.red(
        `[CONFLIT] Impossible de créer cet élément car il existe déjà.`,
      ) +
      yocto.yellow(
        `\n💡 Résolution :\n` +
          `  • Choisissez un autre nom ou supprimez l'ancien fichier au préalable.`,
      ) +
      cleanContext
    );
  }

  // 5. Erreur par défaut si non répertoriée
  return (
    yocto.red(`[ERREUR SYSTÈME] : ${msg.replace(/Error: /g, "")}`) +
    cleanContext
  );
}

// Charge le dataset JSON et extrait la configuration
function loadDataset(filePath) {
  try {
    const rawData = fs.readFileSync(filePath, "utf8");
    dataset = JSON.parse(rawData);

    labels = dataset.labels;
    trainingData = dataset.trainingData;
    responses = dataset.responses;
    actions = dataset.actions || {};

    modelName = dataset.system?.model_name || "ZRM";
    msgPrefix = dataset.system?.prefix || "";
    sysRules = { ...(dataset.system?.rules || {}) };
    currentDatasetPath = filePath;
  } catch (error) {
    throw new Error(
      `Impossible de charger le fichier '${filePath}' : ${error.message}`,
    );
  }
}

try {
  loadDataset(currentDatasetPath);
} catch (error) {
  console.error(yocto.red(error.message));
  process.exit(1);
}

function preparerDonnees() {
  vocabulary = Array.from(
    new Set(trainingData.flatMap((d) => tokenizer.tokenize(d.text))),
  );
}

function encodeText(text) {
  const tokens = tokenizer.tokenize(text);
  return vocabulary.map((word) => (tokens.includes(word) ? 1 : 0));
}

function preparerTenseurs() {
  trainingInputs = trainingData.map((d) => encodeText(d.text));
  trainingOutputs = trainingData.map((d) => {
    const output = new Array(labels.length).fill(0);
    const index = labels.indexOf(d.label);
    output[index] = 1;
    return output;
  });
}

function compilerModel() {
  if (model) {
    try {
      model.dispose();
    } catch (e) {}
  }

  model = tf.sequential();
  model.add(
    tf.layers.dense({
      inputShape: [vocabulary.length],
      units: 16,
      activation: "relu",
    }),
  );
  model.add(tf.layers.dense({ units: 16, activation: "relu" }));
  model.add(tf.layers.dense({ units: labels.length, activation: "softmax" }));

  model.compile({
    optimizer: tf.train.adam(0.01),
    loss: "categoricalCrossentropy",
    metrics: ["accuracy"],
  });
}

preparerDonnees();
preparerTenseurs();
compilerModel();

async function entrainerModel() {
  const sTrain = p.spinner();
  sTrain.start(yocto.dim(`Ajustement des circuits de ${modelName}...`));

  const startTime = performance.now();

  const xs = tf.tensor2d(trainingInputs);
  const ys = tf.tensor2d(trainingOutputs);

  await model.fit(xs, ys, {
    epochs: 120,
    shuffle: true,
    verbose: 0,
  });

  xs.dispose();
  ys.dispose();

  const endTime = performance.now();
  const duration = formatDuration(endTime - startTime);

  sTrain.stop(
    yocto.green(`✓ ${modelName} opérationnel. (Worked for ${duration})`),
  );
}

function executerCommandeSysteme(cmd) {
  return new Promise((resolve) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        resolve(formaterErreur(error, `Lancement de la commande '${cmd}'`));
        return;
      }
      if (stderr) {
        resolve(yocto.yellow(`Alertes d'exécution :\n${stderr}`));
        return;
      }
      resolve(stdout || yocto.dim("(La commande n'a rien renvoyé)"));
    });
  });
}

function extrairePrenom(text) {
  const cleanText = text.toLowerCase();
  const patterns = [
    "je m'appelle ",
    "moi c'est ",
    "mon nom est ",
    "mon blaze c'est ",
  ];
  for (const pattern of patterns) {
    if (cleanText.includes(pattern)) {
      const index = cleanText.indexOf(pattern) + pattern.length;
      const remaining = text.substring(index).trim();
      return remaining.split(" ")[0];
    }
  }
  const words = text.trim().split(/\s+/);
  return words[words.length - 1];
}

function extractDir(text) {
  const match = text.match(
    /(?:creer|nouveau|make|mkdir)\s+(?:un\s+|le\s+)?dossier\s+([^\s]+)/i,
  );
  if (match) return match[1];
  const match2 = text.match(/(?:dossier|dir)\s+([^\s]+)/i);
  if (match2) return match2[1];
  return null;
}

// Filtre pour éviter de capturer l'action de suppression dans la création de fichier
function extractFile(text) {
  if (text.match(/supprimer|supprime|efface|delete|rm|remove/i)) return null;
  const match = text.match(
    /(?:creer|nouveau|touch|make)\s+(?:un\s+|le\s+)?fichier\s+([^\s]+)/i,
  );
  if (match) return match[1];
  const match2 = text.match(/(?:fichier|file)\s+([^\s]+)/i);
  if (match2) return match2[1];
  return null;
}

function extractRename(text) {
  const match = text.match(
    /(?:renommer|renomme|mv|move)\s+([^\s]+)\s+(?:en|vers|par|to)\s+([^\s]+)/i,
  );
  if (match) return { oldPath: match[1], newPath: match[2] };
  return null;
}

function extractDelete(text) {
  const match = text.match(
    /(?:supprimer|supprime|efface|delete|rm|remove)\s+(?:le\s+|un\s+|dossier\s+|fichier\s+)?([^\s]+)/i,
  );
  if (match) return match[1];
  return null;
}

function extractKill(text) {
  const portMatch = text.match(/(?:port|:)\s*(\d+)/i);
  if (portMatch) return { type: "port", value: portMatch[1] };

  const pidMatch = text.match(/(?:pid|processus|process)\s+(\d+)/i);
  if (pidMatch) return { type: "pid", value: pidMatch[1] };

  const numMatch = text.match(/(?:kill|tue|arrete|stop)\s+(\d+)/i);
  if (numMatch) {
    const val = parseInt(numMatch[1]);
    if (val > 1024 && val < 65535) return { type: "port", value: numMatch[1] };
    return { type: "pid", value: numMatch[1] };
  }

  const nameMatch = text.match(
    /(?:kill|tue|arrete|stop|processus|process)\s+(?:le\s+|l\'\s+)?([a-zA-Z0-9_\-\.]+)/i,
  );
  if (nameMatch) return { type: "name", value: nameMatch[1] };

  return null;
}

function extractCustomCommand(text) {
  const match = text.match(
    /(?:lance\s+la\s+commande|execute\s+la\s+commande|run\s+command|command|execute|lance|run)\s+(.+)/i,
  );
  if (match) return match[1].trim();
  return null;
}

async function gererActionDynamique(intent, inputStr) {
  let result = "";

  if (intent === "dir_create") {
    let path = extractDir(inputStr);
    if (!path) {
      path = await p.text({
        message: yocto.cyan("Quel est le nom du dossier à créer ?"),
        placeholder: "ex: mon-projet/src",
        validate(v) {
          if (!v.trim()) return "Le nom ne peut pas être vide.";
        },
      });
      if (p.isCancel(path)) return yocto.yellow("Création de dossier annulée.");
    }
    try {
      fs.mkdirSync(path, { recursive: true });
      result = yocto.green(`✓ Dossier '${path}' créé avec succès.`);
    } catch (e) {
      result = formaterErreur(e, `Création du dossier '${path}'`);
    }
  } else if (intent === "file_create") {
    let path = extractFile(inputStr);
    if (!path) {
      path = await p.text({
        message: yocto.cyan("Quel est le nom du fichier à créer ?"),
        placeholder: "ex: index.js",
        validate(v) {
          if (!v.trim()) return "Le nom ne peut pas être vide.";
        },
      });
      if (p.isCancel(path)) return yocto.yellow("Création de fichier annulée.");
    }
    try {
      fs.writeFileSync(path, "");
      result = yocto.green(`✓ Fichier '${path}' créé avec succès.`);
    } catch (e) {
      result = formaterErreur(e, `Création du fichier '${path}'`);
    }
  } else if (intent === "file_rename") {
    let targets = extractRename(inputStr);
    if (!targets) {
      const oldPath = await p.text({
        message: yocto.cyan("Quel est le fichier d'origine à renommer ?"),
        validate(v) {
          if (!v.trim()) return "Le nom ne peut pas être vide.";
        },
      });
      if (p.isCancel(oldPath)) return yocto.yellow("Opération annulée.");

      const newPath = await p.text({
        message: yocto.cyan(`Quel nouveau nom donner à '${oldPath}' ?`),
        validate(v) {
          if (!v.trim()) return "Le nom ne peut pas être vide.";
        },
      });
      if (p.isCancel(newPath)) return yocto.yellow("Opération annulée.");

      targets = { oldPath, newPath };
    }
    try {
      fs.renameSync(targets.oldPath, targets.newPath);
      result = yocto.green(
        `✓ Renommé : '${targets.oldPath}' -> '${targets.newPath}'`,
      );
    } catch (e) {
      result = formaterErreur(
        e,
        `Renommage du fichier '${targets.oldPath}' en '${targets.newPath}'`,
      );
    }
  } else if (intent === "file_delete") {
    let path = extractDelete(inputStr);
    if (!path) {
      path = await p.text({
        message: yocto.cyan(
          "Quel est le chemin du fichier ou dossier à supprimer ?",
        ),
        placeholder: "ex: temp/ ou logs.txt",
        validate(v) {
          if (!v.trim()) return "La cible ne peut pas être vide.";
        },
      });
      if (p.isCancel(path)) return yocto.yellow("Suppression annulée.");
    }

    if (!fs.existsSync(path)) {
      return formaterErreur(
        new Error("ENOENT"),
        `Tentative d'accès à '${path}' pour suppression`,
      );
    }

    const stats = fs.statSync(path);
    const isDir = stats.isDirectory();
    const itemType = isDir ? "dossier" : "fichier";

    const confirm = await p.confirm({
      message: yocto.red(
        `Voulez-vous vraiment supprimer définitivement le ${itemType} '${path}' ?`,
      ),
      active: "Oui, supprimer",
      inactive: "Non, annuler",
    });

    if (p.isCancel(confirm) || !confirm) {
      return yocto.yellow("Opération de suppression sécurisée annulée.");
    }

    try {
      fs.rmSync(path, { recursive: true, force: true });
      result = yocto.green(
        `✓ Le ${itemType} '${path}' a été supprimé définitivement.`,
      );
    } catch (e) {
      result = formaterErreur(e, `Suppression de '${path}'`);
    }
  } else if (intent === "process_kill") {
    let target = extractKill(inputStr);
    if (!target) {
      const type = await p.select({
        message: yocto.cyan("Quel type de cible voulez-vous arrêter ?"),
        options: [
          { value: "port", label: "Un port réseau (ex: 3000)" },
          { value: "pid", label: "Un PID de processus (ex: 1234)" },
          { value: "name", label: "Un nom de processus (ex: node)" },
        ],
      });
      if (p.isCancel(type)) return yocto.yellow("Opération annulée.");

      const value = await p.text({
        message: yocto.cyan(`Entrez la valeur pour la cible (${type}) :`),
        validate(v) {
          if (!v.trim()) return "La valeur ne peut pas être vide.";
        },
      });
      if (p.isCancel(value)) return yocto.yellow("Opération annulée.");

      target = { type, value };
    }

    const isWin = os.platform() === "win32";
    if (target.type === "pid") {
      const cmd = isWin
        ? `taskkill /F /PID ${target.value}`
        : `kill -9 ${target.value}`;
      result = await executerCommandeSysteme(cmd);
    } else if (target.type === "name") {
      const cmd = isWin
        ? `taskkill /F /IM "${target.value}.exe" /IM "${target.value}"`
        : `pkill -f "${target.value}"`;
      result = await executerCommandeSysteme(cmd);
    } else if (target.type === "port") {
      if (isWin) {
        const findCmd = `netstat -ano | findstr :${target.value}`;
        const findResult = await executerCommandeSysteme(findCmd);
        if (
          findResult.includes("[COMMANDE INTROUVABLE]") ||
          findResult.includes("[ACCÈS REFUSÉ]")
        ) {
          return findResult;
        }
        const lines = findResult
          .trim()
          .split("\n")
          .filter((l) => l.includes("LISTENING"));
        if (lines.length > 0) {
          const parts = lines[0].trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && !isNaN(pid)) {
            result = await executerCommandeSysteme(`taskkill /F /PID ${pid}`);
          } else {
            result = yocto.red(
              `Impossible de récupérer le PID du port ${target.value}.`,
            );
          }
        } else {
          result = yocto.yellow(
            `Aucun processus actif trouvé sur le port ${target.value}.`,
          );
        }
      } else {
        const cmd = `kill -9 $(lsof -t -i:${target.value}) 2>/dev/null || fuser -k ${target.value}/tcp 2>/dev/null`;
        result = await executerCommandeSysteme(cmd);
      }
    }
  } else if (intent === "custom_command") {
    let cmd = extractCustomCommand(inputStr);
    if (!cmd) {
      cmd = await p.text({
        message: yocto.cyan(
          "Quelle commande système souhaitez-vous exécuter ?",
        ),
        placeholder: "ex: bun install ou git push",
        validate(v) {
          if (!v.trim()) return "La commande ne peut pas être vide.";
        },
      });
      if (p.isCancel(cmd))
        return yocto.yellow("Exécution de commande annulée.");
    }

    const sCmd = p.spinner();
    sCmd.start(yocto.dim(`[USER-CMD] Exécution de : ${cmd}`));
    result = await executerCommandeSysteme(cmd);
    sCmd.stop(yocto.green("[USER-CMD] Exécution terminée"));
  }

  return result;
}

async function executerCommandeCLI(commande, etatSession) {
  const cmd = commande.toLowerCase().trim();
  switch (cmd) {
    case "/help":
      p.note(
        `${yocto.magenta("/new")}       - Reset la session active\n` +
          `${yocto.magenta("/dataset")}   - Switch de fichier JSON\n` +
          `${yocto.magenta("/settings")}  - Configuration de ZRM\n` +
          `${yocto.magenta("/quit")}      - Quitter le shell\n` +
          `${yocto.magenta("/help")}      - Liste des commandes`,
        "Commandes CLI",
      );
      return true;
    case "/quit":
      p.outro(yocto.yellow(`${modelName} : Session fermée.`));
      process.exit(0);
    case "/new":
      etatSession.userName = "l'ami";
      etatSession.dernierIntent = null;
      p.note(yocto.green("Mémoire flashée !"), "Système");
      return true;
    case "/settings":
      await gererSettings();
      return true;
    case "/dataset":
      await gererDatasets();
      return true;
    default:
      p.note(yocto.red(`Inconnu. Tape /help.`), "Erreur");
      return true;
  }
}

async function gererSettings() {
  let enConfiguration = true;
  while (enConfiguration) {
    const option = await p.select({
      message: "Configuration",
      options: [
        {
          value: "toggle_uppercase",
          label: `Majuscules (${sysRules.force_uppercase ? yocto.green("ON") : yocto.red("OFF")})`,
        },
        {
          value: "toggle_timestamp",
          label: `Timestamp (${sysRules.show_timestamp ? yocto.green("ON") : yocto.red("OFF")})`,
        },
        {
          value: "toggle_mood",
          label: `ASCII Mood (${sysRules.ascii_art_mood ? yocto.green("ON") : yocto.red("OFF")})`,
        },
        { value: "exit", label: yocto.yellow("← Retour") },
      ],
    });
    if (p.isCancel(option) || option === "exit") {
      enConfiguration = false;
      break;
    }
    if (option === "toggle_uppercase")
      sysRules.force_uppercase = !sysRules.force_uppercase;
    else if (option === "toggle_timestamp")
      sysRules.show_timestamp = !sysRules.show_timestamp;
    else if (option === "toggle_mood")
      sysRules.ascii_art_mood = !sysRules.ascii_art_mood;
  }
}

async function gererDatasets() {
  try {
    const files = fs.readdirSync(".").filter((f) => f.endsWith(".json"));
    if (files.length === 0) {
      p.note(yocto.yellow("Pas de .json trouvé."), "Système");
      return;
    }
    const options = files.map((file) => {
      const isActif = `./${file}` === currentDatasetPath;
      return {
        value: `./${file}`,
        label: isActif ? `${file} ${yocto.green("(Actif)")}` : file,
      };
    });
    options.push({ value: "cancel", label: yocto.yellow("← Retour") });

    const selectedFile = await p.select({
      message: "Injecter dataset :",
      options,
    });

    if (p.isCancel(selectedFile) || selectedFile === "cancel") return;

    const sReload = p.spinner();
    sReload.start(yocto.dim(`Injection...`));
    const startReloadTime = performance.now();
    await sleep(400);

    loadDataset(selectedFile);
    preparerDonnees();
    preparerTenseurs();
    compilerModel();

    const endReloadTime = performance.now();
    const reloadDuration = formatDuration(endReloadTime - startReloadTime);
    sReload.stop(
      yocto.green(
        `✓ Dataset ré-aligné : ${selectedFile} (Reloaded in ${reloadDuration})`,
      ),
    );
    await entrainerModel();
  } catch (error) {
    p.note(
      formaterErreur(error, `Chargement du dataset '${selectedFile}'`),
      "Erreur",
    );
  }
}

async function main() {
  console.clear();
  p.intro(
    yocto.bgMagenta(
      yocto.black(`  ${modelName.toUpperCase()} - SECURE ACTIONS ROUTER  `),
    ),
  );

  await entrainerModel();
  p.note(
    'ZRM est prêt à monitorer ta machine.\nEssaie de lui demander de renommer un fichier, tuer un port, créer des dossiers ou lancer une commande comme "command git status".',
    "Système",
  );

  const etatSession = { userName: "l'ami", dernierIntent: null };

  while (true) {
    const input = await p.text({
      message: yocto.cyan("Toi :"),
      placeholder: 'Que veux-tu faire ? (ex: "command codex")',
      validate(value) {
        if (!value.trim()) return "Parle.";
      },
    });

    if (p.isCancel(input)) {
      p.outro(yocto.yellow(`${modelName} : Session fermée.`));
      process.exit(0);
    }

    const inputStr = input.trim();
    if (inputStr.startsWith("/")) {
      await executerCommandeCLI(inputStr, etatSession);
      continue;
    }

    // --- 1. DÉMARRAGE DU COMPTEUR GLOBAL ---
    const startTotalTime = performance.now();

    const sAi = p.spinner();
    sAi.start();

    await sleep(250);

    // Inférence TensorFlow
    const inputVector = tf.tensor2d([encodeText(inputStr)]);
    const prediction = model.predict(inputVector);
    const probabilities = prediction.dataSync();
    const labelIndex = prediction.argMax(1).dataSync()[0];
    const maxConfidence = probabilities[labelIndex];

    inputVector.dispose();
    prediction.dispose();

    let intent = labels[labelIndex];
    if (maxConfidence < 0.65) intent = "inconnu";

    sAi.stop();

    let typeReponse = "standard";
    if (intent !== "inconnu" && intent === etatSession.dernierIntent)
      typeReponse = "repetition";
    if (intent !== "inconnu") etatSession.dernierIntent = intent;

    if (intent === "presentation") {
      const prenomDetecte = extrairePrenom(inputStr);
      if (prenomDetecte) etatSession.userName = prenomDetecte;
    }

    // --- Application des Instructions Système & Rendu ---
    let reponseFinale;
    if (intent === "inconnu") {
      reponseFinale =
        "Commande ou intention non répertoriée dans ma base locale.";
    } else {
      let reponseBrute = responses[intent]?.[typeReponse] || "Erreur critique.";
      reponseFinale = reponseBrute.replace(/{name}/g, etatSession.userName);
    }

    if (sysRules.force_uppercase) reponseFinale = reponseFinale.toUpperCase();

    if (sysRules.show_timestamp) {
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      reponseFinale = `[${timeStr}] ${reponseFinale}`;
    }

    // --- 2. CALCUL ET DÉCISION DE L'AFFICHAGE DU CHRONO ---
    const listDynamicIntents = [
      "dir_create",
      "file_create",
      "file_rename",
      "file_delete",
      "process_kill",
      "custom_command",
    ];
    const hasAction =
      listDynamicIntents.includes(intent) ||
      (intent !== "inconnu" && actions[intent]);

    if (!hasAction) {
      // S'il n'y a aucune action à faire, le processus se termine ici.
      // On calcule et affiche le temps global sur le message principal du bot.
      const totalDuration = formatDuration(performance.now() - startTotalTime);
      const noteTitle = `${msgPrefix}${modelName} (Worked for ${totalDuration})`;
      p.note(reponseFinale, yocto.magenta(noteTitle));
    } else {
      // S'il y a une action, on affiche d'abord la réponse texte sans chrono
      const noteTitle = `${msgPrefix}${modelName}`;
      p.note(reponseFinale, yocto.magenta(noteTitle));

      // A. Traitement des Opérations Dynamiques (Moteur de Fichiers & Process)
      if (listDynamicIntents.includes(intent)) {
        const dResult = await gererActionDynamique(intent, inputStr);

        // Calcul final de la durée une fois l'action finie (inclut l'interaction utilisateur)
        const totalDuration = formatDuration(
          performance.now() - startTotalTime,
        );
        p.note(
          dResult,
          yocto.yellow(`Action - ${intent} (Worked for ${totalDuration})`),
        );
        continue;
      }

      // B. Exécution de l'Action Shell Classique (définie dans le dataset)
      if (intent !== "inconnu" && actions[intent]) {
        const platform = os.platform();
        const commandeAExecuter =
          platform === "win32"
            ? actions[intent].win32 || actions[intent].default
            : actions[intent].default;

        const sShell = p.spinner();
        sShell.start(yocto.dim(`[SYSTEM] Exécution de : ${commandeAExecuter}`));

        const result = await executerCommandeSysteme(commandeAExecuter);
        sShell.stop(yocto.green("[SYSTEM] Commande terminée"));

        // Calcul final de la durée de l'inférence + de l'exécution shell
        const totalDuration = formatDuration(
          performance.now() - startTotalTime,
        );
        p.note(
          result,
          yocto.yellow(
            `Sortie Shell - ${intent} (Worked for ${totalDuration})`,
          ),
        );
      }
    }
  }
}

main().catch(console.error);

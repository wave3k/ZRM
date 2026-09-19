import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, "..", ".models");

const MODELS = {
  fast: {
    label: "Rapide (0.5B)",
    file: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    url: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
    size: 491400032,
  },
  quality: {
    label: "Qualité (1.5B)",
    file: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
    url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
    size: 1117320736,
  },
};

function human(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(0)} Mo`;
}

async function download(model) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  const dest = path.join(MODELS_DIR, model.file);

  if (fs.existsSync(dest)) {
    const size = fs.statSync(dest).size;
    if (size === model.size) {
      console.log(`  ✓ ${model.label} déjà téléchargé (${human(size)})`);
      return;
    }
    console.log(`  Reprise du téléchargement de ${model.label} (${human(size)}/${human(model.size)})`);
  }

  console.log(`  ↓ ${model.label} — ${human(model.size)}`);
  await new Promise((resolve, reject) => {
    const args = ["-L", "-C", "-", "--retry", "5", "--retry-delay", "3", "-o", dest, model.url];
    const child = spawn("curl", args, { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`curl code ${code}`))));
    child.on("error", reject);
  });
  console.log(`  ✓ ${model.label} prêt`);
}

const which = process.argv[2];
const targets = which ? [which] : Object.keys(MODELS);

for (const id of targets) {
  const model = MODELS[id];
  if (!model) {
    console.error(`Modèle inconnu : ${id}`);
    process.exit(1);
  }
  try {
    await download(model);
  } catch (error) {
    console.error(`  ✗ Échec pour ${model.label} : ${error.message}`);
  }
}

console.log("\nTerminé. Les modèles sont dans .models/");

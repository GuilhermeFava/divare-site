#!/usr/bin/env node
/**
 * Atualiza a faixa do Instagram do Divare sem agente de IA no ciclo.
 *
 * Uso:
 *   node scripts/update-instagram.mjs
 *   node scripts/update-instagram.mjs --dry-run
 *   node scripts/update-instagram.mjs --force
 *
 * O script abre o perfil público com Playwright headless, fecha o aviso de
 * login, lê as 12 publicações mais recentes, baixa as capas, gera WebP 1x/2x
 * em fotos/instagram/ e reescreve só o bloco entre os marcadores
 * <!-- instagram:start --> e <!-- instagram:end --> no index.html.
 *
 * Segurança: se o Instagram bloquear/pedir login ou vierem menos de 6 posts,
 * nada é alterado, o erro vai para logs/instagram.log e o processo sai com 1.
 * Idempotência: com a mesma lista, não baixa nem reescreve nada; capas que
 * saíram da grade são removidas.
 */
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const indexFile = join(root, "index.html");
const outDir = join(root, "fotos/instagram");
const altFile = join(root, "scripts/instagram-alt.json");
const manifestFile = join(outDir, "manifest.json");
const logFile = join(root, "logs/instagram.log");
const profile = process.env.INSTAGRAM_PROFILE || "https://www.instagram.com/divareloungebeauty/";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

function log(message) {
  mkdirSync(join(root, "logs"), { recursive: true });
  appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
}

function fail(message) {
  log(`ERROR ${message}`);
  console.error(message);
  process.exit(1);
}

const esc = (value) => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");
const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const typeLabel = { post: "Post", reel: "Reel" };
const formatDate = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${months[month - 1]}`;
};
const dateOf = (alt) => {
  const match = String(alt || "").match(/on ([A-Z][a-z]+) (\d{1,2}), (\d{4})/);
  if (!match) return null;
  const month = ["January","February","March","April","May","June","July","August","September","October","November","December"].indexOf(match[1]) + 1;
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, "0")}-${String(match[2]).padStart(2, "0")}`;
};

async function closeOverlays(page) {
  await page.keyboard.press("Escape").catch(() => {});
  const labels = [
    /^Fechar$/i, /^Close$/i, /^Agora não$/i, /^Not now$/i,
    /^Permitir todos os cookies$/i, /^Allow all cookies$/i, /^Aceitar$/i,
  ];
  for (const name of labels) {
    const button = page.getByRole("button", { name }).first();
    if (!(await button.count().catch(() => 0))) continue;
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(250);
  }
}

async function scrape() {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "pt-BR",
    userAgent: UA,
  });
  const page = await context.newPage();
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));

  try {
    await page.goto(profile, { waitUntil: "domcontentloaded", timeout: 45000 });
    await closeOverlays(page);
    await page.waitForFunction(
      () => document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]').length >= 6,
      { timeout: 20000 },
    ).catch(() => {});
    if (page.url().includes("/accounts/login")) {
      throw new Error("Instagram redirecionou para o login.");
    }

    const posts = await page.evaluate(() => {
      const seen = new Set();
      const out = [];
      for (const anchor of document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')) {
        const href = new URL(anchor.getAttribute("href"), location.origin).href;
        const match = href.match(/\/(p|reel)\/([^/]+)/);
        const img = anchor.querySelector("img");
        if (!match || !img || seen.has(match[2])) continue;
        seen.add(match[2]);
        out.push({
          id: match[2],
          url: href,
          type: match[1] === "reel" ? "reel" : "post",
          cover: img.currentSrc || img.getAttribute("src") || null,
          instagramAlt: img.getAttribute("alt") || "",
        });
      }
      return out;
    });

    if (posts.length < 6) throw new Error(`O Instagram retornou ${posts.length} publicações; mínimo 6.`);
    const selected = posts.slice(0, 12);
    if (selected.length < 12) log(`WARN apenas ${selected.length} publicações disponíveis; seguindo com essas.`);
    if (selected.some((post) => !post.cover || !post.date && !dateOf(post.instagramAlt))) {
      throw new Error("Publicação sem capa ou sem data legível.");
    }
    for (const post of selected) {
      post.date = dateOf(post.instagramAlt);
      if (!post.date) throw new Error(`Data não reconhecida na publicação ${post.id}.`);
    }
    return { browser, context, posts: selected };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

function imageSize(file) {
  const info = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { encoding: "utf8" });
  const width = Number(info.match(/pixelWidth: (\d+)/)?.[1]);
  const height = Number(info.match(/pixelHeight: (\d+)/)?.[1]);
  if (!width || !height) throw new Error(`Não foi possível ler as dimensões de ${file}`);
  return { width, height };
}

function convert(source, width, dest) {
  execFileSync("cwebp", ["-quiet", "-q", "82", "-resize", String(width), "0", source, "-o", dest]);
}

async function downloadCover(context, url, dest) {
  const response = await context.request.get(url, {
    headers: { referer: profile, "user-agent": UA, accept: "image/avif,image/webp,image/jpeg,image/png,*/*" },
    timeout: 30000,
  });
  if (!response.ok()) {
    // Fallback fora do contexto do navegador; algumas URLs não exigem cookies.
    const fallback = await fetch(url, { headers: { "user-agent": UA } });
    if (!fallback.ok) throw new Error(`HTTP ${response.status()} ao baixar capa.`);
    writeFileSync(dest, Buffer.from(await fallback.arrayBuffer()));
    return;
  }
  writeFileSync(dest, await response.body());
}

function altFor(post, overrides) {
  if (overrides[post.id]) return overrides[post.id];
  const raw = String(post.instagramAlt || "")
    .replace(/^(Photo|Video) by .*? on .*?\.\s*/i, "")
    .trim();
  return raw || `Publicação do Instagram do Divare em ${formatDate(post.date)}.`;
}

function render(posts, meta, overrides) {
  const cards = posts.map((post, index) => {
    const size = meta[post.id];
    if (!size) throw new Error(`Sem metadados de imagem para ${post.id}.`);
    const one = `fotos/instagram/${size.one}`;
    const two = `fotos/instagram/${size.two}`;
    const reel = post.type === "reel"
      ? `\n            <span class="ig-reel" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5z"/></svg></span>`
      : "";
    return `        <a class="ig-card" href="${esc(post.url)}" target="_blank" rel="noopener">
          <span class="ig-media">
            <img src="${two}" srcset="${one} 240w, ${two} ${size.width}w" sizes="(min-width:1181px) 249px, (min-width:761px) 31vw, 268px" width="${size.width}" height="${size.height}" alt="${esc(altFor(post, overrides))}" loading="${index < 3 ? "eager" : "lazy"}" decoding="async">${reel}
          </span>
          <span class="ig-caption">${formatDate(post.date)} · ${typeLabel[post.type] ?? "Post"}</span>
        </a>`;
  });
  return `      <div class="ig-track-head">
        <p>Últimas publicações do Instagram.</p>
        <div class="ig-nav">
          <button type="button" data-ig-prev aria-label="Publicações anteriores"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg></button>
          <button type="button" data-ig-next aria-label="Próximas publicações"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M9.5 5.5L16 12l-6.5 6.5"/></svg></button>
        </div>
      </div>
      <div class="ig-track" id="ig-track" tabindex="0" role="region" aria-label="Últimas publicações do Instagram">
${cards.join("\n")}
      </div>`;
}

async function prepareImages(context, posts) {
  const temp = join(outDir, `.tmp-${process.pid}`);
  rmSync(temp, { recursive: true, force: true });
  mkdirSync(temp, { recursive: true });
  const meta = {};
  try {
    for (const post of posts) {
      const source = join(temp, `${post.id}.img`);
      await downloadCover(context, post.cover, source);
      const { width, height } = imageSize(source);
      const oneWidth = Math.min(240, width);
      const twoWidth = Math.min(480, width);
      const oneName = `ig-${post.id}-1x.webp`;
      const twoName = `ig-${post.id}-2x.webp`;
      convert(source, oneWidth, join(temp, oneName));
      if (oneWidth === twoWidth) writeFileSync(join(temp, twoName), readFileSync(join(temp, oneName)));
      else convert(source, twoWidth, join(temp, twoName));
      meta[post.id] = {
        one: oneName,
        two: twoName,
        width: twoWidth,
        height: Math.round((height * twoWidth) / width),
      };
      rmSync(source, { force: true });
      log(`IMG ${post.id} ${twoWidth}x${meta[post.id].height}`);
    }

    // Só depois de todas as imagens prontas o diretório publicado é trocado.
    for (const name of readdirSync(outDir)) {
      if (name.startsWith("ig-")) rmSync(join(outDir, name), { force: true });
    }
    for (const name of readdirSync(temp)) renameSync(join(temp, name), join(outDir, name));
    writeFileSync(manifestFile, JSON.stringify({ signature: signature(posts), posts: meta }, null, 2) + "\n");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  return meta;
}

function signature(posts) {
  return posts.map((post) => `${post.id}|${post.date}|${post.type}`).join("\n");
}

function readManifest() {
  if (!existsSync(manifestFile)) return null;
  try {
    return JSON.parse(readFileSync(manifestFile, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const overrides = existsSync(altFile) ? JSON.parse(readFileSync(altFile, "utf8")) : {};
  const { browser, context, posts } = await scrape();
  try {
    if (dryRun) {
      console.log(JSON.stringify(posts.map((post) => ({
        id: post.id,
        date: post.date,
        type: post.type,
        url: post.url,
        cover: post.cover,
      })), null, 2));
      log(`DRY-RUN ${posts.length} publicações; nada alterado.`);
      return;
    }

    const oldManifest = readManifest();
    const same = oldManifest?.signature === signature(posts)
      && posts.every((post) => oldManifest.posts?.[post.id])
      && posts.every((post) => {
        const entry = oldManifest.posts[post.id];
        return existsSync(join(outDir, entry.one)) && existsSync(join(outDir, entry.two));
      });

    let meta = oldManifest?.posts ?? {};
    if (force || !same) meta = await prepareImages(context, posts);

    const html = readFileSync(indexFile, "utf8");
    const start = html.indexOf("      <!-- instagram:start -->");
    const end = html.indexOf("      <!-- instagram:end -->", start);
    if (start < 0 || end < 0) throw new Error("Marcadores instagram:start/end não encontrados no index.html.");
    const markerEnd = "      <!-- instagram:end -->".length;
    const block = `      <!-- instagram:start -->\n${render(posts, meta, overrides)}\n      <!-- instagram:end -->`;
    const next = `${html.slice(0, start)}${block}${html.slice(end + markerEnd)}`;
    if (next !== html) {
      writeFileSync(indexFile, next);
      log(`OK ${posts.length} publicações; HTML atualizado; imagens ${force || !same ? "atualizadas" : "reaproveitadas"}.`);
    } else {
      log(`OK ${posts.length} publicações; sem diff.`);
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

try {
  await main();
} catch (error) {
  fail(error?.message || String(error));
}

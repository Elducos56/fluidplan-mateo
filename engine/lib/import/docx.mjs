// Home-grown .docx reader, no dependencies: a .docx is a zip of XML files (Office Open XML).
// The goal is to give Claude Markdown that is faithful to the document's *structure* (headings,
// lists, tables, links, images) so it can cut it into a plan; reproducing the layout is not a goal.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

// ---------------------------------------------------------------------------------------------
// API

// Reads a .docx (path or Buffer) and returns { markdown, media: [{ name, bytes }], warnings }.
// With outDir: writes outDir/source.md and outDir/<mediaDir>/<name>, and also returns { mdPath, mediaPaths }.
export async function importDocx(file, { outDir, mediaDir = "media" } = {}) {
  const { buffer, label } = await loadInput(file);
  if (buffer.length >= 8 && buffer.readUInt32BE(0) === 0xd0cf11e0 && buffer.readUInt32BE(4) === 0xa1b11ae1) {
    // OLE container: what Word 97-2003 produces, and what Word produces for an encrypted .docx.
    throw new Error(`${label} is an old Word document (.doc) or a password-protected .docx: open it in Word and save it as a .docx without a password.`);
  }
  let zip;
  try {
    zip = openZip(buffer);
  } catch (err) {
    throw new Error(`${label} is not a readable .docx. ${err.message}`);
  }

  const warnings = [];
  const readXml = (name, required = false) => {
    const found = name && zip.find(name);
    if (!found) return undefined;
    try {
      return decodeXml(zip.read(found));
    } catch (err) {
      if (required) throw new Error(`${label} is corrupted: ${found} is unreadable (${err.message}).`);
      warnings.push(`${found} is unreadable, skipped (${err.message}).`);
      return undefined;
    }
  };

  const docPath = locateMainDocument(zip, readXml);
  if (!docPath) {
    throw new Error(`${label} is a zip archive but contains no word/document.xml: it is not a Word document (.docx).`);
  }
  const docDir = docPath.includes("/") ? docPath.slice(0, docPath.lastIndexOf("/")) : "";
  const relsXml = readXml(joinPart(docDir, `_rels/${docPath.slice(docDir.length).replace(/^\//, "")}.rels`));
  const docRels = readRels(parseXml(relsXml ?? ""));
  const partOf = (suffix, fallback) => {
    for (const rel of docRels.values()) {
      if (!rel.external && rel.type.endsWith(suffix)) return resolvePart(docDir, rel.target);
    }
    return joinPart(docDir, fallback);
  };

  const converted = convertDocument(readXml(docPath, true), {
    stylesXml: readXml(partOf("/styles", "styles.xml")),
    numberingXml: readXml(partOf("/numbering", "numbering.xml")),
    relsXml,
    mediaDir,
    partDir: docDir,
  });

  const media = [];
  for (const image of converted.images) {
    const found = zip.find(image.part);
    try {
      if (!found) throw new Error("missing from the archive");
      media.push({ name: image.name, bytes: zip.read(found) });
    } catch (err) {
      warnings.push(`Image ${image.part} not extracted (${err.message}): the Markdown link points nowhere.`);
    }
  }

  const result = { markdown: converted.markdown, media, warnings: [...warnings, ...converted.warnings] };
  if (outDir) {
    await mkdir(outDir, { recursive: true });
    const mdPath = path.join(outDir, "source.md");
    await writeFile(mdPath, result.markdown, "utf8");
    const mediaPaths = [];
    if (media.length) {
      const dir = path.join(outDir, mediaDir);
      await mkdir(dir, { recursive: true });
      for (const item of media) {
        const target = path.join(dir, item.name);
        await writeFile(target, item.bytes);
        mediaPaths.push(target);
      }
    }
    Object.assign(result, { mdPath, mediaPaths });
  }
  return result;
}

// Minimal zip: central directory, stored (0) or deflated (8) entries. Returns a Map name → Buffer.
// An unreadable entry is skipped (with a warning in `warnings` if given) rather than losing everything.
export function readZip(buffer, { warnings } = {}) {
  const zip = openZip(buffer);
  const files = new Map();
  for (const name of zip.names) {
    try {
      files.set(name, zip.read(name));
    } catch (err) {
      warnings?.push(`Entry "${name}" skipped: ${err.message}.`);
    }
  }
  return files;
}

// XML of word/document.xml (+ styles, numbering, relationships) → Markdown.
// `warnings` (optional array) receives the conversion warnings.
export function documentToMarkdown(documentXml, { stylesXml, numberingXml, relsXml, mediaDir = "media", partDir = "word", warnings } = {}) {
  const converted = convertDocument(documentXml, { stylesXml, numberingXml, relsXml, mediaDir, partDir });
  if (Array.isArray(warnings)) warnings.push(...converted.warnings);
  return converted.markdown;
}

// ---------------------------------------------------------------------------------------------
// Input and zip

async function loadInput(file) {
  if (Buffer.isBuffer(file)) return { buffer: file, label: "The document" };
  if (ArrayBuffer.isView(file)) return { buffer: Buffer.from(file.buffer, file.byteOffset, file.byteLength), label: "The document" };
  if (file instanceof ArrayBuffer) return { buffer: Buffer.from(file), label: "The document" };
  const label = `"${path.basename(String(file instanceof URL ? file.pathname : file))}"`;
  try {
    return { buffer: await readFile(file), label };
  } catch (err) {
    if (err.code === "ENOENT") throw new Error(`File not found: ${file}`);
    if (err.code === "EISDIR") throw new Error(`${file} is a folder, not a .docx file.`);
    throw new Error(`Cannot read ${file}: ${err.message}`);
  }
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_END64 = 0x06064b50;
const SIG_END64_LOCATOR = 0x07064b50;
const U32_MAX = 0xffffffff;

function openZip(input) {
  const buf = toBuffer(input);
  const end = findEndOfCentralDirectory(buf);
  if (end === -1) {
    throw new Error("Not a zip archive (end of central directory not found): a file in another format, or truncated.");
  }
  let entries;
  try {
    entries = readCentralDirectory(buf, end);
  } catch (err) {
    if (err instanceof RangeError) throw new Error("Corrupted zip archive: structure outside the file's bounds.");
    throw err;
  }
  const byLowerName = new Map([...entries.keys()].map((name) => [name.toLowerCase(), name]));
  // OPC part names are case-insensitive and sometimes %xx-encoded in the relationships.
  const find = (name) => {
    if (entries.has(name)) return name;
    const lower = byLowerName.get(name.toLowerCase());
    if (lower) return lower;
    try {
      const decoded = decodeURIComponent(name);
      return entries.has(decoded) ? decoded : byLowerName.get(decoded.toLowerCase());
    } catch {
      return undefined;
    }
  };
  return {
    names: [...entries.keys()],
    find,
    read(name) {
      const entry = entries.get(find(name));
      if (!entry) throw new Error(`missing entry: ${name}`);
      return extract(buf, entry);
    },
  };
}

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  throw new TypeError("A Buffer is expected to read a zip archive.");
}

function findEndOfCentralDirectory(buf) {
  // The end-of-archive comment is at most 65,535 bytes long: no need to search any further.
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let p = buf.length - 22; p >= min; p--) {
    if (buf[p] === 0x50 && buf[p + 1] === 0x4b && buf.readUInt32LE(p) === SIG_END) return p;
  }
  return -1;
}

function readCentralDirectory(buf, end) {
  const corrupt = (why) => new Error(`Corrupted zip archive: ${why}.`);
  let count = buf.readUInt16LE(end + 10);
  let size = buf.readUInt32LE(end + 12);
  let offset = buf.readUInt32LE(end + 16);
  if (count === 0xffff || size === U32_MAX || offset === U32_MAX) {
    const locator = end - 20;
    if (locator >= 0 && buf.readUInt32LE(locator) === SIG_END64_LOCATOR) {
      const record = toSafeNumber(buf.readBigUInt64LE(locator + 8));
      if (record + 56 <= buf.length && buf.readUInt32LE(record) === SIG_END64) {
        count = toSafeNumber(buf.readBigUInt64LE(record + 32));
        size = toSafeNumber(buf.readBigUInt64LE(record + 40));
        offset = toSafeNumber(buf.readBigUInt64LE(record + 48));
      }
    }
  }
  if (offset + size > buf.length) throw corrupt("central directory outside the file (truncated file?)");

  const entries = new Map();
  let p = offset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) throw corrupt("unreadable central directory entry");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    let csize = buf.readUInt32LE(p + 20);
    let usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen).replace(/\\/g, "/");
    if (csize === U32_MAX || usize === U32_MAX || local === U32_MAX) {
      // ZIP64 extra field (id 1): only the values saturated at 0xFFFFFFFF appear there, in this order.
      for (let e = p + 46 + nameLen, stop = e + extraLen; e + 4 <= stop; e += 4 + buf.readUInt16LE(e + 2)) {
        if (buf.readUInt16LE(e) !== 1) continue;
        let q = e + 4;
        const next = () => toSafeNumber(buf.readBigUInt64LE((q += 8) - 8));
        if (usize === U32_MAX) usize = next();
        if (csize === U32_MAX) csize = next();
        if (local === U32_MAX) local = next();
        break;
      }
    }
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    entries.set(name, { flags, method, csize, usize, local });
  }
  return entries;
}

function toSafeNumber(big) {
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("zip64 value out of range");
  return Number(big);
}

function extract(buf, entry) {
  if (entry.flags & 1) throw new Error("encrypted entry");
  const p = entry.local;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== SIG_LOCAL) throw new Error("local header not found");
  // The name and extra lengths in the local header may differ from those in the central directory.
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const stop = start + entry.csize;
  if (stop > buf.length) throw new Error("truncated data");
  const data = buf.subarray(start, stop);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) {
    try {
      return inflateRawSync(data);
    } catch (err) {
      throw new Error(`decompression failed (${err.message})`);
    }
  }
  throw new Error(`compression method ${entry.method} not supported`);
}

function decodeXml(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.toString("utf16le", 2);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const body = Buffer.from(bytes.subarray(2, 2 + ((bytes.length - 2) & ~1)));
    return body.swap16().toString("utf16le");
  }
  return bytes.toString("utf8");
}

function locateMainDocument(zip, readXml) {
  const rootRels = readRels(parseXml(readXml("_rels/.rels") ?? ""));
  for (const rel of rootRels.values()) {
    if (rel.external || !rel.type.endsWith("/officeDocument")) continue;
    const found = zip.find(resolvePart("", rel.target));
    if (found) return found;
  }
  return zip.find("word/document.xml");
}

function joinPart(dir, name) {
  return dir ? `${dir}/${name}` : name;
}

function resolvePart(baseDir, target) {
  const clean = String(target).replace(/\\/g, "/");
  const parts = clean.startsWith("/") ? [] : String(baseDir).split("/").filter(Boolean);
  for (const segment of clean.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

// ---------------------------------------------------------------------------------------------
// XML: home-grown tokenizer that builds a light tree { name, attrs, children, text }.
// An element's text is the concatenation of its direct text nodes: WordprocessingML does not mix
// text and tags inside the same element (text lives in w:t, w:instrText, m:t).

// The usual prefixes (w:, r:, a:…) are a convention, not a guarantee: a file rewritten by a
// third-party tool may say ns0:p. So every known namespace is mapped back to its canonical prefix.
const CANONICAL_PREFIX = new Map([
  ["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "w"],
  ["http://purl.oclc.org/ooxml/wordprocessingml/main", "w"],
  ["http://schemas.openxmlformats.org/officeDocument/2006/relationships", "r"],
  ["http://purl.oclc.org/ooxml/officeDocument/relationships", "r"],
  ["http://schemas.openxmlformats.org/drawingml/2006/main", "a"],
  ["http://purl.oclc.org/ooxml/drawingml/main", "a"],
  ["http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", "wp"],
  ["http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing", "wp"],
  ["http://schemas.openxmlformats.org/markup-compatibility/2006", "mc"],
  ["http://schemas.openxmlformats.org/officeDocument/2006/math", "m"],
  ["http://purl.oclc.org/ooxml/officeDocument/math", "m"],
  ["urn:schemas-microsoft-com:vml", "v"],
  ["http://schemas.openxmlformats.org/package/2006/relationships", ""],
]);

const BASE_NAMESPACES = Object.assign(Object.create(null), { xml: "http://www.w3.org/XML/1998/namespace" });
const NAMED_ENTITIES = new Map([["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", '"'], ["apos", "'"]]);

function decodeEntities(text) {
  if (!text.includes("&")) return text;
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (match, body) => {
    if (body[0] !== "#") return NAMED_ENTITIES.get(body) ?? match;
    const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
    return valid ? String.fromCodePoint(code) : match;
  });
}

function isNameChar(c) {
  return (c >= 48 && c <= 58) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 45 || c === 46 || c >= 0x80;
}

function isSpace(c) {
  return c === 32 || c === 9 || c === 10 || c === 13;
}

function qualify(raw, ns, isAttribute) {
  const colon = raw.indexOf(":");
  // An unprefixed attribute belongs to no namespace, even under a default xmlns.
  if (colon === -1 && isAttribute) return raw;
  const uri = ns[colon === -1 ? "" : raw.slice(0, colon)];
  const canonical = uri === undefined ? undefined : CANONICAL_PREFIX.get(uri);
  if (canonical === undefined) return raw;
  const local = colon === -1 ? raw : raw.slice(colon + 1);
  return canonical ? `${canonical}:${local}` : local;
}

function parseXml(source, warn = () => {}) {
  const src = String(source ?? "").replace(/^﻿/, "");
  const root = { name: "#document", attrs: {}, children: [], text: "" };
  const stack = [{ node: root, raw: "", ns: BASE_NAMESPACES }];
  const n = src.length;
  const after = (index, length) => (index === -1 ? n : index + length);
  let anomalies = 0;
  let i = 0;

  while (i < n) {
    const top = stack[stack.length - 1];
    const lt = src.indexOf("<", i);
    const textEnd = lt === -1 ? n : lt;
    if (textEnd > i) top.node.text += decodeEntities(src.slice(i, textEnd));
    if (lt === -1) break;
    i = lt;
    const next = src.charCodeAt(i + 1);

    if (next === 33 /* ! */) {
      if (src.startsWith("<!--", i)) {
        i = after(src.indexOf("-->", i + 4), 3);
      } else if (src.startsWith("<![CDATA[", i)) {
        const close = src.indexOf("]]>", i + 9);
        top.node.text += src.slice(i + 9, close === -1 ? n : close);
        i = after(close, 3);
      } else {
        // <!DOCTYPE …> and the like, with an optional internal subset in square brackets.
        let depth = 0;
        let j = i + 2;
        for (; j < n; j++) {
          const c = src[j];
          if (c === "[") depth++;
          else if (c === "]") depth--;
          else if (c === ">" && depth <= 0) break;
        }
        i = j + 1;
      }
      continue;
    }
    if (next === 63 /* ? */) {
      i = after(src.indexOf("?>", i + 2), 2);
      continue;
    }
    if (next === 47 /* / */) {
      const close = src.indexOf(">", i + 2);
      const raw = src.slice(i + 2, close === -1 ? n : close).trim();
      i = after(close, 1);
      let k = stack.length - 1;
      while (k > 0 && stack[k].raw !== raw) k--;
      if (k === 0) anomalies++;
      else {
        if (k !== stack.length - 1) anomalies++;
        stack.length = k;
      }
      continue;
    }

    let j = i + 1;
    while (j < n && isNameChar(src.charCodeAt(j))) j++;
    if (j === i + 1) {
      top.node.text += "<";
      i++;
      continue;
    }
    const raw = src.slice(i + 1, j);
    const rawAttrs = [];
    let selfClosing = false;
    for (;;) {
      while (j < n && isSpace(src.charCodeAt(j))) j++;
      if (j >= n) {
        anomalies++;
        break;
      }
      const c = src.charCodeAt(j);
      if (c === 62 /* > */) {
        j++;
        break;
      }
      if (c === 47 /* / */) {
        j++;
        if (src.charCodeAt(j) === 62) {
          selfClosing = true;
          j++;
          break;
        }
        continue;
      }
      let k = j;
      while (k < n && isNameChar(src.charCodeAt(k))) k++;
      if (k === j) {
        anomalies++;
        j++;
        continue;
      }
      const name = src.slice(j, k);
      j = k;
      while (j < n && isSpace(src.charCodeAt(j))) j++;
      let value = "";
      if (src.charCodeAt(j) === 61 /* = */) {
        j++;
        while (j < n && isSpace(src.charCodeAt(j))) j++;
        const quote = src[j];
        if (quote === '"' || quote === "'") {
          const close = src.indexOf(quote, j + 1);
          value = src.slice(j + 1, close === -1 ? n : close);
          j = after(close, 1);
        } else {
          let e = j;
          while (e < n && !isSpace(src.charCodeAt(e)) && src.charCodeAt(e) !== 62) e++;
          value = src.slice(j, e);
          j = e;
        }
      }
      rawAttrs.push([name, decodeEntities(value)]);
    }
    i = j;

    let ns = top.ns;
    for (const [name, value] of rawAttrs) {
      if (name !== "xmlns" && !name.startsWith("xmlns:")) continue;
      if (ns === top.ns) ns = Object.assign(Object.create(null), top.ns);
      ns[name === "xmlns" ? "" : name.slice(6)] = value;
    }
    const attrs = {};
    for (const [name, value] of rawAttrs) {
      attrs[name === "xmlns" || name.startsWith("xmlns:") ? name : qualify(name, ns, true)] = value;
    }
    const node = { name: qualify(raw, ns, false), attrs, children: [], text: "" };
    top.node.children.push(node);
    if (!selfClosing) stack.push({ node, raw, ns });
  }

  if (stack.length > 1) anomalies++;
  if (anomalies) warn(`Irregular XML (${anomalies} markup anomaly(ies)): best-effort reading.`);
  return root;
}

const child = (node, name) => node?.children.find((c) => c.name === name);
const kids = (node, name) => (node ? node.children.filter((c) => c.name === name) : []);
const val = (node, attr = "w:val") => node?.attrs[attr];

function find(node, name) {
  if (!node) return undefined;
  for (const c of node.children) {
    if (c.name === name) return c;
    const deep = find(c, name);
    if (deep) return deep;
  }
  return undefined;
}

// WordprocessingML "toggle" property: present without a value = true, val="0|false|off" = false.
function onOff(node) {
  if (!node) return undefined;
  const value = node.attrs["w:val"];
  return value === undefined || !/^(0|false|off|none)$/i.test(value);
}

// ---------------------------------------------------------------------------------------------
// Context: styles, numbering, relationships

// "Titre" is what French Word calls its built-in heading styles.
function levelFromName(name) {
  const text = String(name ?? "").trim();
  const numbered = /^(?:heading|titre)\s*([1-9])$/i.exec(text);
  if (numbered) return Math.min(Number(numbered[1]), 6);
  return /^(?:title|titre)$/i.test(text) ? 1 : 0;
}

function readStyles(root) {
  const byId = new Map();
  for (const style of kids(find(root, "w:styles"), "w:style")) {
    const id = style.attrs["w:styleId"];
    if (!id) continue;
    const pPr = child(style, "w:pPr");
    const rPr = child(style, "w:rPr");
    const numPr = child(pPr, "w:numPr");
    byId.set(id, {
      name: val(child(style, "w:name")) ?? "",
      basedOn: val(child(style, "w:basedOn")),
      outline: val(child(pPr, "w:outlineLvl")),
      numId: val(child(numPr, "w:numId")),
      ilvl: val(child(numPr, "w:ilvl")),
      b: onOff(child(rPr, "w:b")),
      i: onOff(child(rPr, "w:i")),
    });
  }

  // Walks up the basedOn chain; the depth cap guards against a loop in a damaged styles.xml.
  const inherit = (id, pick) => {
    for (let depth = 0; id && depth < 20; depth++) {
      const style = byId.get(id);
      const value = pick(style, id);
      if (value !== undefined) return value;
      id = style?.basedOn;
    }
    return undefined;
  };
  const headingCache = new Map();
  const runCache = new Map();

  return {
    headingLevel(id) {
      if (!id) return 0;
      if (!headingCache.has(id)) {
        headingCache.set(id, inherit(id, (style, styleId) => {
          const byName = style && levelFromName(style.name);
          if (byName) return byName;
          if (style?.outline !== undefined) {
            const level = parseInt(style.outline, 10);
            if (level >= 0 && level < 9) return Math.min(level + 1, 6);
            if (level === 9) return 0;
          }
          return levelFromName(styleId) || undefined;
        }) ?? 0);
      }
      return headingCache.get(id);
    },
    numPr(id) {
      return inherit(id, (style) => (style?.numId !== undefined ? { numId: style.numId, ilvl: style.ilvl } : undefined));
    },
    runProps(id) {
      if (!id) return { b: false, i: false };
      if (!runCache.has(id)) {
        runCache.set(id, { b: inherit(id, (s) => s?.b) ?? false, i: inherit(id, (s) => s?.i) ?? false });
      }
      return runCache.get(id);
    },
  };
}

function readNumbering(root, styles) {
  const numbering = find(root, "w:numbering");
  const readLevel = (lvl) => ({ fmt: val(child(lvl, "w:numFmt")), start: val(child(lvl, "w:start")) });
  const abstracts = new Map();
  for (const abstract of kids(numbering, "w:abstractNum")) {
    const levels = new Map();
    for (const lvl of kids(abstract, "w:lvl")) levels.set(parseInt(lvl.attrs["w:ilvl"] ?? "0", 10), readLevel(lvl));
    abstracts.set(abstract.attrs["w:abstractNumId"], { levels, styleLink: val(child(abstract, "w:numStyleLink")) });
  }
  const nums = new Map();
  for (const num of kids(numbering, "w:num")) {
    const overrides = new Map();
    for (const override of kids(num, "w:lvlOverride")) {
      const lvl = child(override, "w:lvl");
      const base = lvl ? readLevel(lvl) : {};
      overrides.set(parseInt(override.attrs["w:ilvl"] ?? "0", 10), { fmt: base.fmt, start: val(child(override, "w:startOverride")) ?? base.start });
    }
    nums.set(num.attrs["w:numId"], { abstract: val(child(num, "w:abstractNumId")), overrides });
  }

  const level = (numId, ilvl, depth = 0) => {
    const num = nums.get(numId);
    const abstract = num && abstracts.get(num.abstract);
    if (!abstract) return null;
    // A list can be a mere pointer to a list style that holds the real definition.
    if (!abstract.levels.size && abstract.styleLink && depth < 5) {
      const linked = styles.numPr(abstract.styleLink);
      if (linked?.numId && linked.numId !== numId) return level(linked.numId, ilvl, depth + 1);
    }
    const override = num.overrides.get(ilvl);
    const base = abstract.levels.get(ilvl);
    if (!override && !base) return null;
    const start = parseInt(override?.start ?? base?.start ?? "1", 10);
    return { fmt: override?.fmt ?? base?.fmt ?? "decimal", start: Number.isFinite(start) ? start : 1 };
  };
  return { level };
}

function readRels(root) {
  const rels = new Map();
  for (const rel of kids(find(root, "Relationships"), "Relationship")) {
    if (!rel.attrs.Id) continue;
    rels.set(rel.attrs.Id, {
      type: rel.attrs.Type ?? "",
      target: rel.attrs.Target ?? "",
      external: /^external$/i.test(rel.attrs.TargetMode ?? ""),
    });
  }
  return rels;
}

// ---------------------------------------------------------------------------------------------
// Conversion

function convertDocument(documentXml, { stylesXml, numberingXml, relsXml, mediaDir = "media", partDir = "word" } = {}) {
  const warnings = [];
  const warn = (message) => {
    if (!warnings.includes(message)) warnings.push(message);
  };
  const parsePart = (xml, label) => parseXml(xml ?? "", (message) => warn(`${label} : ${message}`));
  const styles = readStyles(parsePart(stylesXml, "styles.xml"));
  const ctx = {
    warn,
    styles,
    numbering: readNumbering(parsePart(numberingXml, "numbering.xml"), styles),
    rels: readRels(parsePart(relsXml, "document.xml.rels")),
    partDir,
    mediaDir: String(mediaDir ?? "").replace(/\\/g, "/").replace(/\/+$/, ""),
    images: [],
    imagesByPart: new Map(),
    imageNames: new Set(),
    fields: [],
    counters: new Map(),
    tables: 0,
    notes: 0,
  };

  const body = find(parsePart(documentXml, "document.xml"), "w:body");
  const blocks = [];
  if (!body) warn("word/document.xml contains no w:body: empty document or unexpected format.");
  for (const node of body?.children ?? []) {
    // An unexpected element should only cost itself, not the whole document.
    try {
      convertBlocks([node], ctx, blocks, false);
    } catch (err) {
      warn(`Element ${node.name} skipped: ${err.message}`);
    }
  }
  if (ctx.notes) warn(`${ctx.notes} footnote or endnote reference(s): the text of the notes is not imported.`);
  return { markdown: renderBlocks(blocks), images: ctx.images.map(({ part, name }) => ({ part, name })), warnings };
}

function skippedContentControl(sdt) {
  const sdtPr = child(sdt, "w:sdtPr");
  if (child(sdtPr, "w:showingPlcHdr")) return true;
  return /table of contents/i.test(val(find(sdtPr, "w:docPartGallery")) ?? "");
}

// Alternate content (mc:AlternateContent): the modern variant first, the old one as a fallback.
function alternative(node) {
  return (child(node, "mc:Choice") ?? child(node, "mc:Fallback"))?.children ?? [];
}

const SKIPPED_BLOCKS = new Set(["w:del", "w:moveFrom", "w:sectPr", "w:sdtPr", "w:sdtEndPr", "w:tcPr", "w:tblPr", "w:tblGrid", "w:trPr", "w:pPr"]);

function convertBlocks(nodes, ctx, out, cell) {
  for (const node of nodes) {
    if (SKIPPED_BLOCKS.has(node.name)) continue;
    if (node.name === "w:p") paragraph(node, ctx, out, cell);
    else if (node.name === "w:tbl") table(node, ctx, out, cell);
    else if (node.name === "w:sdt" && skippedContentControl(node)) continue;
    else if (node.name === "mc:AlternateContent") convertBlocks(alternative(node), ctx, out, cell);
    else if (node.name === "w:altChunk") ctx.warn("Content inserted as is (altChunk) skipped: open the document in Word and save it to merge it in.");
    else if (node.children.length) convertBlocks(node.children, ctx, out, cell);
  }
}

function paragraph(p, ctx, out, cell) {
  const pPr = child(p, "w:pPr");
  const styleId = val(child(pPr, "w:pStyle"));
  const state = { segments: [], extra: [], link: null };
  inline(p.children, ctx, state, cell);
  if (ctx.fields.some((f) => f.phase === "code")) {
    // A field code does not cross the end of a paragraph: without this safeguard, a badly closed
    // field would hide the whole rest of the document.
    ctx.fields = ctx.fields.filter((f) => f.phase !== "code");
    ctx.warn("Malformed Word field skipped.");
  }

  const level = headingLevel(pPr, styleId, ctx);
  const item = level ? null : listItem(pPr, styleId, ctx);
  if (level) for (const segment of state.segments) segment.b = segment.i = false;
  const lines = renderLines(state.segments);

  if (lines.length) {
    if (level) {
      const text = lines.join(" ");
      out.push(cell ? { type: "para", text } : { type: "heading", text: `${"#".repeat(level)} ${text.replace(/(^|\s)(#+)$/, "$1\\$2")}` });
    } else if (item) {
      const marker = listMarker(item, ctx);
      if (cell) out.push({ type: "para", text: `${marker} ${lines.join("<br>")}` });
      else out.push({ type: "item", level: item.level, marker, lines: lines.map(escapeLineStart) });
    } else {
      out.push({ type: "para", text: cell ? lines.join("<br>") : lines.map(escapeLineStart).join("  \n") });
    }
  }
  out.push(...state.extra);
}

function headingLevel(pPr, styleId, ctx) {
  const direct = val(child(pPr, "w:outlineLvl"));
  if (direct !== undefined) {
    const level = parseInt(direct, 10);
    return level >= 0 && level < 9 ? Math.min(level + 1, 6) : 0;
  }
  return ctx.styles.headingLevel(styleId);
}

function listItem(pPr, styleId, ctx) {
  const numPr = child(pPr, "w:numPr");
  let numId = val(child(numPr, "w:numId"));
  let ilvl = val(child(numPr, "w:ilvl"));
  if (numId === undefined) {
    const fromStyle = ctx.styles.numPr(styleId);
    numId = fromStyle?.numId;
    ilvl ??= fromStyle?.ilvl;
  }
  // numId 0: the numbering inherited from the style is explicitly removed.
  if (numId === undefined || numId === "0") return null;
  return { numId, level: Math.min(Math.max(parseInt(ilvl ?? "0", 10) || 0, 0), 8) };
}

function listMarker(item, ctx) {
  const def = ctx.numbering.level(item.numId, item.level);
  if (!def) ctx.warn(`Unknown numbering (numId ${item.numId}, level ${item.level}): rendered as a bulleted list.`);
  const fmt = def?.fmt ?? "bullet";
  if (fmt === "bullet" || fmt === "none") return "-";
  let counters = ctx.counters.get(item.numId);
  if (!counters) ctx.counters.set(item.numId, (counters = []));
  const number = counters[item.level] === undefined ? def.start : counters[item.level] + 1;
  counters[item.level] = number;
  // As in Word, a higher-level item restarts the numbering of its sub-levels.
  counters.length = item.level + 1;
  return `${number}.`;
}

const SKIPPED_INLINE = new Set(["w:pPr", "w:rPr", "w:del", "w:moveFrom", "w:sdtPr", "w:sdtEndPr", "w:customXmlPr", "w:smartTagPr"]);

function inline(nodes, ctx, state, cell) {
  for (const node of nodes) {
    if (SKIPPED_INLINE.has(node.name)) continue;
    switch (node.name) {
      case "w:r":
        run(node, ctx, state, cell);
        break;
      case "w:hyperlink": {
        const saved = state.link;
        state.link = hyperlinkTarget(node, ctx) ?? saved;
        inline(node.children, ctx, state, cell);
        state.link = saved;
        break;
      }
      case "w:fldSimple": {
        const field = readFieldCode(node.attrs["w:instr"] ?? "");
        if (field.hide) break;
        const saved = state.link;
        state.link = field.link ?? saved;
        inline(node.children, ctx, state, cell);
        state.link = saved;
        break;
      }
      case "w:sdt":
        if (!skippedContentControl(node)) inline(node.children, ctx, state, cell);
        break;
      case "mc:AlternateContent":
        inline(alternative(node), ctx, state, cell);
        break;
      case "m:oMath":
      case "m:oMathPara":
        math(node, ctx, state);
        break;
      default:
        if (node.children.length) inline(node.children, ctx, state, cell);
    }
  }
}

function hyperlinkTarget(node, ctx) {
  const id = node.attrs["r:id"];
  // Without r:id, it is an internal anchor (w:anchor): only the text is kept.
  if (!id) return null;
  const rel = ctx.rels.get(id);
  if (!rel?.target) {
    ctx.warn(`Link ${id} has no target in the document relationships: text kept without the link.`);
    return null;
  }
  return rel.target;
}

function run(r, ctx, state, cell) {
  const rPr = child(r, "w:rPr");
  const base = ctx.styles.runProps(val(child(rPr, "w:rStyle")));
  const format = {
    b: onOff(child(rPr, "w:b")) ?? base.b,
    i: onOff(child(rPr, "w:i")) ?? base.i,
    hidden: Boolean(onOff(child(rPr, "w:vanish")) || onOff(child(rPr, "w:webHidden"))),
  };
  for (const node of r.children) {
    switch (node.name) {
      case "w:t":
        emitText(ctx, state, format, node.text);
        break;
      case "w:tab":
      case "w:ptab":
        emitText(ctx, state, format, " ");
        break;
      case "w:noBreakHyphen":
        emitText(ctx, state, format, "-");
        break;
      case "w:br":
        if (!/^(page|column)$/.test(node.attrs["w:type"] ?? "")) emitBreak(ctx, state, format);
        break;
      case "w:cr":
        emitBreak(ctx, state, format);
        break;
      case "w:fldChar":
        fieldChar(node, ctx);
        break;
      case "w:instrText": {
        const field = ctx.fields[ctx.fields.length - 1];
        if (field?.phase === "code") field.code += node.text;
        break;
      }
      case "w:drawing":
      case "w:pict":
      case "w:object":
      case "mc:AlternateContent":
        drawing(node, ctx, state, format, cell);
        break;
      case "w:footnoteReference":
      case "w:endnoteReference":
        ctx.notes++;
        break;
      default:
        // w:delText, w:commentReference, w:sym, w:softHyphen, w:lastRenderedPageBreak…: nothing to render.
        break;
    }
  }
}

// Fields whose result is layout (table of contents, page numbers) rather than content.
const LAYOUT_FIELDS = new Set(["TOC", "PAGE", "NUMPAGES", "SECTIONPAGES", "PAGEREF", "INDEX", "TOA"]);

function readFieldCode(code) {
  const keyword = (/^\s*([A-Za-z]+)/.exec(code)?.[1] ?? "").toUpperCase();
  let link = null;
  if (keyword === "HYPERLINK" && !/\\l\b/.test(code)) {
    link = /"([^"]+)"/.exec(code)?.[1] ?? /HYPERLINK\s+(\S+)/i.exec(code)?.[1] ?? null;
  }
  return { hide: LAYOUT_FIELDS.has(keyword), link };
}

function fieldChar(node, ctx) {
  const type = node.attrs["w:fldCharType"];
  if (type === "begin") ctx.fields.push({ phase: "code", code: "", hide: false, link: null });
  else if (type === "separate") {
    const field = ctx.fields[ctx.fields.length - 1];
    if (field?.phase === "code") Object.assign(field, { phase: "result" }, readFieldCode(field.code));
  } else if (type === "end") ctx.fields.pop();
}

// A field's code is never content; its result is, except for layout fields.
function fieldHidden(ctx) {
  return ctx.fields.some((f) => f.phase === "code" || f.hide);
}

function currentLink(ctx, state) {
  if (state.link) return state.link;
  for (let k = ctx.fields.length - 1; k >= 0; k--) if (ctx.fields[k].link) return ctx.fields[k].link;
  return null;
}

function emitText(ctx, state, format, text) {
  if (!text || format.hidden || fieldHidden(ctx)) return;
  const clean = text.replace(/[\t\r\n]/g, " ");
  state.segments.push({ text: escapeInline(clean), b: format.b, i: format.i, link: currentLink(ctx, state) });
}

function emitBreak(ctx, state, format) {
  if (format.hidden || fieldHidden(ctx)) return;
  state.segments.push({ br: true });
}

function drawing(node, ctx, state, format, cell) {
  if (format.hidden || fieldHidden(ctx)) return;
  const found = { images: [], boxes: [], unsupported: false, alt: "" };
  // Start from a dummy parent so that the node itself goes through the dispatch: a direct
  // mc:AlternateContent must read only one of its variants, not both.
  scanDrawing({ children: [node] }, found);
  for (const image of found.images) {
    const markdown = imageMarkdown(image, ctx);
    if (markdown) state.segments.push({ text: markdown, b: false, i: false, link: currentLink(ctx, state) });
  }
  for (const box of found.boxes) convertBlocks(box.children, ctx, state.extra, cell);
  if (!found.images.length && !found.boxes.length && found.unsupported) {
    ctx.warn("Chart or SmartArt not converted: only the document's text and images are imported.");
  }
}

function scanDrawing(node, found) {
  const count = () => found.images.length + found.boxes.length;
  for (const c of node.children) {
    if (c.name === "w:txbxContent") found.boxes.push(c);
    else if (c.name === "a:blip" || c.name === "v:imagedata") found.images.push({ node: c, alt: found.alt });
    else if (c.name === "mc:AlternateContent") {
      const before = count();
      const choice = child(c, "mc:Choice");
      if (choice) scanDrawing(choice, found);
      // The fallback variant is only read if the modern one yielded nothing usable: for a recent
      // chart, the fallback is just a "not available in your version of Word" message.
      const fallback = child(c, "mc:Fallback");
      if (count() === before && !found.unsupported && fallback) scanDrawing(fallback, found);
    } else {
      if (c.name === "wp:docPr") found.alt = c.attrs.descr || c.attrs.title || "";
      if (/:(chart|relIds)$/.test(c.name)) found.unsupported = true;
      scanDrawing(c, found);
    }
  }
}

function imageMarkdown({ node, alt }, ctx) {
  const id = node.attrs["r:embed"] ?? node.attrs["r:id"] ?? node.attrs["r:link"];
  if (!id) return null;
  const rel = ctx.rels.get(id);
  if (!rel?.target) {
    ctx.warn(`Image ${id} has no target in the document relationships: skipped.`);
    return null;
  }
  const label = String(alt ?? "").replace(/\s+/g, " ").trim().replace(/[\\[\]]/g, "\\$&");
  if (rel.external) return `![${label}](${formatUrl(rel.target)})`;
  const part = resolvePart(ctx.partDir, rel.target);
  let entry = ctx.imagesByPart.get(part);
  if (!entry) {
    entry = { part, name: uniqueMediaName(ctx, part) };
    ctx.imagesByPart.set(part, entry);
    ctx.images.push(entry);
    if (/\.(emf|wmf)$/i.test(part)) ctx.warn(`Image ${entry.name} is in EMF/WMF format: neither the browser nor Markdown can display it.`);
  }
  return `![${label}](${formatUrl(ctx.mediaDir ? `${ctx.mediaDir}/${entry.name}` : entry.name)})`;
}

// Safe file name (no separator, no character forbidden on Windows) that is unique regardless of
// case, since two names differing only by case overwrite each other on Windows.
function uniqueMediaName(ctx, part) {
  let name = part.split("/").pop().replace(/[^\w.-]+/g, "_").replace(/^\.+/, "") || "image";
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; ctx.imageNames.has(name.toLowerCase()); n++) name = `${stem}-${n}${ext}`;
  ctx.imageNames.add(name.toLowerCase());
  return name;
}

function math(node, ctx, state) {
  if (fieldHidden(ctx)) return;
  const parts = [];
  const walk = (n) => {
    for (const c of n.children) {
      if (c.name === "m:t") parts.push(c.text);
      else walk(c);
    }
  };
  walk(node);
  const text = parts.join("").trim();
  if (!text) return;
  state.segments.push({ text: escapeInline(text), b: false, i: false, link: null });
  ctx.warn("Equation(s) rendered as plain text, without math formatting.");
}

// ---------------------------------------------------------------------------------------------
// Tables

function collectChildren(node, name, skip) {
  const found = [];
  for (const c of node.children) {
    if (c.name === name) found.push(c);
    else if (!skip.has(c.name)) found.push(...collectChildren(c, name, skip));
  }
  return found;
}

const ROW_SKIP = new Set(["w:tblPr", "w:tblGrid", "w:del", "w:moveFrom", "w:sdtPr", "w:sdtEndPr"]);
const CELL_SKIP = new Set(["w:trPr", "w:tblPrEx", "w:del", "w:moveFrom", "w:sdtPr", "w:sdtEndPr"]);

function table(tbl, ctx, out, cell) {
  const index = ++ctx.tables;
  let merged = false;
  const rows = [];
  for (const tr of collectChildren(tbl, "w:tr", ROW_SKIP)) {
    const trPr = child(tr, "w:trPr");
    if (child(trPr, "w:del")) continue;
    const cells = [];
    const pad = (count) => {
      for (let k = 0; k < count; k++) cells.push("");
    };
    pad(parseInt(val(child(trPr, "w:gridBefore")) ?? "0", 10) || 0);
    for (const tc of collectChildren(tr, "w:tc", CELL_SKIP)) {
      const tcPr = child(tc, "w:tcPr");
      const span = Math.max(1, parseInt(val(child(tcPr, "w:gridSpan")) ?? "1", 10) || 1);
      const vMerge = child(tcPr, "w:vMerge");
      const hMerge = child(tcPr, "w:hMerge");
      if (span > 1 || vMerge || hMerge) merged = true;
      // A cell that continues a merge has no text of its own: it is rendered empty.
      const continued = [vMerge, hMerge].some((m) => m && (m.attrs["w:val"] ?? "continue") === "continue");
      cells.push(continued ? "" : cellText(tc, ctx));
      pad(span - 1);
    }
    pad(parseInt(val(child(trPr, "w:gridAfter")) ?? "0", 10) || 0);
    rows.push(cells);
  }
  if (merged) ctx.warn(`Table ${index}: merged cells rendered approximately (empty cells added).`);
  if (!rows.length) return;

  const width = Math.max(1, ...rows.map((r) => r.length));
  for (const r of rows) while (r.length < width) r.push("");
  if (cell) {
    ctx.warn(`Table ${index} nested in a cell: flattened to text.`);
    const text = rows.map((r) => r.filter(Boolean).join(" / ")).filter(Boolean).join("<br>");
    if (text) out.push({ type: "para", text });
    return;
  }
  const line = (cells) => `| ${cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`;
  const lines = [line(rows[0]), line(rows[0].map(() => "---")), ...rows.slice(1).map(line)];
  out.push({ type: "table", text: lines.join("\n") });
}

function cellText(tc, ctx) {
  const blocks = [];
  convertBlocks(tc.children, ctx, blocks, true);
  return blocks.map((b) => b.text).filter(Boolean).join("<br>");
}

// ---------------------------------------------------------------------------------------------
// Markdown rendering

const WORD_CHAR = /[\p{L}\p{N}]/u;

function escapeInline(text) {
  return text
    .replace(/[\\`*[\]]/g, "\\$&")
    .replace(/<(?=[A-Za-z/!?])/g, "\\<")
    .replace(/&(?=#?\w+;)/g, "\\&")
    // An _ between two letters (snake_case) cannot open emphasis: no need to escape it.
    .replace(/_/g, (m, at, s) => (WORD_CHAR.test(s[at - 1] ?? "") && WORD_CHAR.test(s[at + 1] ?? "") ? "_" : "\\_"));
}

// What, at the start of a paragraph line, would be read as a heading, a list, a quote or a rule.
function escapeLineStart(line) {
  if (/^(#|>|[-+](\s|$)|~~~|=+\s*$|(-\s*){3,}$)/.test(line)) return `\\${line}`;
  const ordered = /^(\d{1,9})([.)])(\s|$)/.exec(line);
  return ordered ? `${ordered[1]}\\${line.slice(ordered[1].length)}` : line;
}

function formatUrl(url) {
  return String(url).trim().replace(/[\s()<>|]/g, (c) => (c === "(" ? "%28" : c === ")" ? "%29" : encodeURIComponent(c)));
}

function renderLines(segments) {
  const lines = [[]];
  for (const segment of segments) {
    if (segment.br) lines.push([]);
    else lines[lines.length - 1].push(segment);
  }
  return lines.map((l) => renderLine(l).trim()).filter(Boolean);
}

function renderLine(segments) {
  // A blank segment takes the formatting of the previous one: "**a** **b**" becomes "**a b**".
  let previous = null;
  const normalized = segments.map((s) => {
    const adopted = previous && !s.text.trim() && s.link === previous.link ? { ...s, b: previous.b, i: previous.i } : s;
    previous = adopted;
    return adopted;
  });
  let out = "";
  for (let k = 0; k < normalized.length;) {
    let e = k;
    while (e < normalized.length && normalized[e].link === normalized[k].link) e++;
    const inner = renderEmphasis(normalized.slice(k, e));
    const url = normalized[k].link;
    if (url && inner.trim()) {
      const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
      out += `${lead}[${core}](${formatUrl(url)})${trail}`;
    } else {
      out += inner;
    }
    k = e;
  }
  return out;
}

// Opens and closes ** and * only when the formatting changes, which merges identical neighboring
// runs; edge spaces stay outside the markers, otherwise CommonMark does not recognize them.
function renderEmphasis(segments) {
  const open = [];
  let out = "";
  let pendingSpace = "";
  for (const s of segments) {
    const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(s.text);
    if (!core) {
      pendingSpace += s.text;
      continue;
    }
    const wanted = [];
    if (s.b) wanted.push("**");
    if (s.i) wanted.push("*");
    let closing = "";
    const cut = open.findIndex((marker) => !wanted.includes(marker));
    if (cut !== -1) while (open.length > cut) closing += open.pop();
    let opening = "";
    for (const marker of wanted) {
      if (!open.includes(marker)) {
        open.push(marker);
        opening += marker;
      }
    }
    out += closing + pendingSpace + lead + opening + core;
    pendingSpace = trail;
  }
  let closing = "";
  while (open.length) closing += open.pop();
  return out + closing + pendingSpace;
}

function renderBlocks(blocks) {
  let out = "";
  let previous = null;
  let widths = [];
  for (const block of blocks) {
    let text = block.text;
    if (block.type === "item") {
      if (previous?.type !== "item") widths = [];
      // CommonMark aligns a sub-list with the content of its parent item, so the indentation
      // depends on the actual width of the markers above ("-" = 2, "1." = 3, "10." = 4).
      let indent = 0;
      for (let k = 0; k < block.level; k++) indent += widths[k] ?? 2;
      widths[block.level] = block.marker.length + 1;
      widths.length = block.level + 1;
      const first = `${" ".repeat(indent)}${block.marker} `;
      const next = " ".repeat(first.length);
      text = block.lines.map((l, k) => (k ? next : first) + l).join("  \n");
    }
    if (!text) continue;
    if (out) out += block.type === "item" && previous?.type === "item" ? "\n" : "\n\n";
    out += text;
    previous = block;
  }
  return out ? `${out}\n` : "";
}

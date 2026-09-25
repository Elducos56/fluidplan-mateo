import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { documentToMarkdown, importDocx, readZip } from "../../engine/lib/import/docx.mjs";

// --- Minimal zip writer: local headers + central directory + end of directory ------------------
// CRC32 computed by hand: zlib.crc32 only exists from Node 22 on.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(files, { method = 8 } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  const names = Object.keys(files);
  for (const name of names) {
    const content = files[name];
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const packed = method === 8 ? deflateRawSync(data) : data;
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0x21, 12); // January 1, 1980
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);

    parts.push(local, nameBytes, packed);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

// --- Small Word document --------------------------------------------------------------------------

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS = [
  `xmlns:w="${W}"`,
  `xmlns:r="${R}"`,
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
].join(" ");
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

const CONTENT_TYPES = `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

const ROOT_RELS = `${XML_DECL}<Relationships xmlns="${PKG}">
  <Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const STYLES = `${XML_DECL}<w:styles xmlns:w="${W}">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Titre1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="CustomSection"><w:name w:val="Custom section"/><w:basedOn w:val="Heading2"/></w:style>
  <w:style w:type="paragraph" w:styleId="a3"><w:name w:val="heading 3"/></w:style>
  <w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>
</w:styles>`;

const NUMBERING = `${XML_DECL}<w:numbering xmlns:w="${W}">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const DOC_RELS = `${XML_DECL}<Relationships xmlns="${PKG}">
  <Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="${REL}/numbering" Target="numbering.xml"/>
  <Relationship Id="rId3" Type="${REL}/hyperlink" Target="https://example.com/doc?a=1&amp;b=2" TargetMode="External"/>
  <Relationship Id="rId4" Type="${REL}/image" Target="media/image1.png"/>
  <Relationship Id="rId9" Type="${REL}/header" Target="header1.xml"/>
  <Relationship Id="rId10" Type="${REL}/comments" Target="comments.xml"/>
</Relationships>`;

const t = (text) => `<w:t xml:space="preserve">${text}</w:t>`;
const r = (text, rPr = "") => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}${t(text)}</w:r>`;
const p = (content, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${content}</w:p>`;
const style = (id) => `<w:pStyle w:val="${id}"/>`;
const list = (numId, ilvl) => `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`;
const tc = (content, tcPr = "") => `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ""}${p(content)}</w:tc>`;
const tr = (...cells) => `<w:tr>${cells.join("")}</w:tr>`;
const tbl = (...rows) => `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid>${rows.join("")}</w:tbl>`;
const documentXml = (body, ns = NS) =>
  `${XML_DECL}<w:document ${ns}><w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rId9"/></w:sectPr></w:body></w:document>`;

const IMAGE = `<w:r><w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="Image 1" descr="Architecture diagram"/>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>
<pic:blipFill><a:blip r:embed="rId4"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

const BODY = [
  p(r("Migration plan"), style("Titre1")),
  p(r("Context"), style("Heading2")),
  p([
    r("Text with "),
    r("bold ", "<w:b/>"),
    r("continued", "<w:b/>"),
    r(", "),
    r("italic", "<w:i/>"),
    r(" not bold", '<w:b w:val="0"/>'),
    r(" and a "),
    `<w:hyperlink r:id="rId3"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>${t("link")}</w:r></w:hyperlink>`,
    r(" &amp; &lt;tag&gt; &#169;&#xAE;."),
    '<w:commentRangeStart w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>',
  ].join("")),
  p(r("First point"), list(1, 0)),
  p(r("Sub-point"), list(1, 1)),
  p(r("Second point"), list(1, 0)),
  p(r("Step one"), list(2, 0)),
  p(r("Step two"), list(2, 0)),
  p(r("Detail"), list(2, 1)),
  tbl(
    tr(tc(r("Option")), tc(r("Cost")), tc(r("Risk"))),
    tr(tc(r("A | B")), tc(r("10 €")), tc(r("low", "<w:b/>"))),
  ),
  p(IMAGE),
  p(r("#1 priority: security")),
  p(`${r("Version ")}<w:del w:id="1" w:author="X"><w:r><w:delText>obsolete</w:delText></w:r></w:del><w:ins w:id="2" w:author="X">${r("revised")}</w:ins>${r(" approved")}`),
  p(`${r("Line one")}<w:r><w:br/></w:r>${r("Line two")}<w:r><w:tab/></w:r>${r("after tab")}`),
].join("\n");

function docxFiles(body = BODY) {
  return {
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": documentXml(body),
    "word/styles.xml": STYLES,
    "word/numbering.xml": NUMBERING,
    "word/_rels/document.xml.rels": DOC_RELS,
    "word/header1.xml": `${XML_DECL}<w:hdr xmlns:w="${W}">${p(r("CONFIDENTIAL HEADER"))}</w:hdr>`,
    "word/comments.xml": `${XML_DECL}<w:comments xmlns:w="${W}"><w:comment w:id="0">${p(r("Secret comment"))}</w:comment></w:comments>`,
    "word/media/image1.png": PNG,
  };
}

// --- Tests ---------------------------------------------------------------------------------------

test("the test writer's CRC32 is correct", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("importDocx converts headings, formatting, links, lists, table, image and tracked changes", async () => {
  const { markdown, media, warnings } = await importDocx(makeZip(docxFiles()));

  assert.match(markdown, /^# Migration plan\n\n## Context\n\n/);
  assert.ok(
    markdown.includes("Text with **bold continued**, *italic* not bold and a [link](https://example.com/doc?a=1&b=2) & \\<tag> ©®."),
    markdown,
  );
  assert.ok(markdown.includes("- First point\n  - Sub-point\n- Second point\n1. Step one\n2. Step two\n   1. Detail\n"), markdown);
  assert.ok(markdown.includes("| Option | Cost | Risk |\n| --- | --- | --- |\n| A \\| B | 10 € | **low** |"), markdown);
  assert.ok(markdown.includes("![Architecture diagram](media/image1.png)"), markdown);
  assert.ok(markdown.includes("\n\\#1 priority: security\n"), markdown);
  assert.ok(markdown.includes("Version revised approved"), markdown);
  assert.ok(!markdown.includes("obsolete"));
  assert.ok(markdown.includes("Line one  \nLine two after tab"), markdown);
  assert.ok(!markdown.includes("CONFIDENTIAL"));
  assert.ok(!markdown.includes("Secret comment"));
  assert.ok(!markdown.includes("\n\n\n"));

  assert.equal(media.length, 1);
  assert.equal(media[0].name, "image1.png");
  assert.deepEqual(media[0].bytes, PNG);
  assert.deepEqual(warnings, []);
});

test("documentToMarkdown: exact output on a minimal document", () => {
  const xml = documentXml([
    p(r("Title"), style("Heading1")),
    p(`${r("Hello ")}${r("world", "<w:b/>")}${r(".")}`),
    p(r("one"), list(1, 0)),
    p(r("two"), list(1, 0)),
    p(r("End"), style("a3")),
  ].join(""));
  assert.equal(
    documentToMarkdown(xml, { stylesXml: STYLES, numberingXml: NUMBERING }),
    "# Title\n\nHello **world**.\n\n- one\n- two\n\n### End\n",
  );
});

test("documentToMarkdown: inherited styles, character style, fields, hidden text, merged cells", () => {
  const warnings = [];
  const xml = documentXml([
    p(r("Inherited from Heading2"), style("CustomSection")),
    p(r("Titre style missing from styles.xml"), style("Titre")),
    p(`${r("word ")}${r("strong", '<w:rStyle w:val="Strong"/>')}${r(" hidden", "<w:vanish/>")}`),
    // Table of contents: its result spans several paragraphs and must not show up.
    p(`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${r("TOC entry 3")}`),
    p(`${r("Another entry 4")}<w:r><w:fldChar w:fldCharType="end"/></w:r>`),
    p(`${r("See ")}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "https://example.org/a b" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${r("the site")}<w:r><w:fldChar w:fldCharType="end"/></w:r>`),
    p(`<w:hyperlink w:anchor="_Toc1">${r("internal anchor")}</w:hyperlink>`),
    // Text box: the modern variant only, not its VML fallback duplicate.
    p(`<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><w:txbxContent>${p(r("In the box"))}</w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent>${p(r("VML duplicate"))}</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r>`),
    tbl(
      tr(tc(r("Large"), '<w:gridSpan w:val="2"/>'), tc(r("C"))),
      tr(tc(r("tall"), '<w:vMerge w:val="restart"/>'), tc(r("b")), tc(r("c"))),
      tr(tc("", "<w:vMerge/>"), tc(r("y")), tc(r("z"))),
    ),
  ].join(""));
  const markdown = documentToMarkdown(xml, { stylesXml: STYLES, warnings });

  assert.match(markdown, /^## Inherited from Heading2\n\n# Titre style missing from styles\.xml\n\n/);
  assert.ok(markdown.includes("word **strong**\n"), markdown);
  assert.ok(!markdown.includes("hidden"));
  assert.ok(!markdown.includes("TOC entry") && !markdown.includes("Another entry"), markdown);
  assert.ok(markdown.includes("See [the site](https://example.org/a%20b)"), markdown);
  assert.ok(markdown.includes("\ninternal anchor\n"), markdown);
  assert.ok(markdown.includes("\nIn the box\n") && !markdown.includes("VML duplicate"), markdown);
  assert.ok(markdown.includes("| Large |  | C |\n| --- | --- | --- |\n| tall | b | c |\n|  | y | z |"), markdown);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /merged cells/);
});

test("documentToMarkdown: non-standard namespace prefixes and damaged XML", () => {
  const ns0 = `xmlns:ns0="${W}"`;
  const xml = `<ns0:document ${ns0}><ns0:body><ns0:p><ns0:r><ns0:t>Rewritten by a third-party tool</ns0:t></ns0:r></ns0:p></ns0:body></ns0:document>`;
  assert.equal(documentToMarkdown(xml), "Rewritten by a third-party tool\n");

  const warnings = [];
  const broken = `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Truncated`;
  assert.equal(documentToMarkdown(broken, { warnings }), "Truncated\n");
  assert.match(warnings[0], /Irregular XML/);
  assert.equal(documentToMarkdown("not xml at all"), "");
});

test("importDocx with outDir writes source.md and media/image1.png", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fluidplan-docx-"));
  try {
    const input = path.join(dir, "plan.docx");
    fs.writeFileSync(input, makeZip(docxFiles()));
    const out = path.join(dir, "import");
    const result = await importDocx(input, { outDir: out });

    assert.equal(result.mdPath, path.join(out, "source.md"));
    assert.equal(fs.readFileSync(result.mdPath, "utf8"), result.markdown);
    assert.deepEqual(result.mediaPaths, [path.join(out, "media", "image1.png")]);
    assert.deepEqual(fs.readFileSync(path.join(out, "media", "image1.png")), PNG);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a file that is not a .docx throws a clear error", async () => {
  await assert.rejects(importDocx(Buffer.from("this is not a zip")), /Not a zip archive/);
  assert.throws(() => readZip(Buffer.from("PK but not really")), /Not a zip archive/);

  const truncated = makeZip(docxFiles()).subarray(0, 200);
  await assert.rejects(importDocx(truncated), /zip archive|[Cc]orrupted/);

  await assert.rejects(importDocx(makeZip({ "readme.txt": "hello" })), /word\/document\.xml/);

  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
  await assert.rejects(importDocx(ole), /old Word document \(\.doc\)/);

  await assert.rejects(importDocx(path.join(os.tmpdir(), "fluidplan-missing-42.docx")), /File not found/);
});

test("a stored entry (method 0) is read as is", async () => {
  const files = readZip(makeZip({ "a.txt": "stored as is", "b/c.bin": Buffer.from([0, 1, 2, 255]) }, { method: 0 }));
  assert.equal(files.get("a.txt").toString("utf8"), "stored as is");
  assert.deepEqual(files.get("b/c.bin"), Buffer.from([0, 1, 2, 255]));

  // A fully stored .docx without _rels/.rels: word/document.xml is found by its usual name.
  const stored = makeZip({ "word/document.xml": documentXml(p(r("Stored"))) }, { method: 0 });
  const { markdown } = await importDocx(stored);
  assert.equal(markdown, "Stored\n");
});

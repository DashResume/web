/* ---------- Constants ---------- */
const BLOCK_TYPES = [
  "name",
  "summary",
  "work",
  "skills",
  "education",
  "achievements",
];
const LABELS = {
  name: "Name",
  summary: "Summary",
  work: "Work Experience",
  skills: "Skills",
  education: "Education",
  achievements: "Achievements",
};
const SINGLE_SELECT = { name: true, summary: true };

/* ---------- Storage helpers ---------- */
function loadBlocks() {
  const raw = localStorage.getItem("blocks");
  if (raw) return JSON.parse(raw);
  const empty = {};
  BLOCK_TYPES.forEach((t) => (empty[t] = []));
  return empty;
}
function saveBlocks(blocks) {
  localStorage.setItem("blocks", JSON.stringify(blocks));
}
function loadResumes() {
  const raw = localStorage.getItem("resumes");
  return raw ? JSON.parse(raw) : [];
}
function saveResumes(resumes) {
  localStorage.setItem("resumes", JSON.stringify(resumes));
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

let blocks = loadBlocks();
let resumes = loadResumes();

/* ---------- Export / Import ---------- */
function exportData() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    blocks,
    resumes,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `resume-blocks-backup-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Exported data");
}

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (e) {
      showToast("That file isn't valid JSON");
      return;
    }
    importData(data);
  };
  reader.onerror = () => showToast("Could not read that file");
  reader.readAsText(file);
}

function normalizeForCompare(s) {
  return (s || "").trim().toLowerCase();
}

// Two selections count as "the same resume" if the title matches and every
// picked block (after remapping to local IDs) matches too, order aside.
function selectionsEqual(a, b) {
  const norm = (sel) =>
    JSON.stringify({
      name: sel.name || null,
      summary: sel.summary || null,
      work: [...(sel.work || [])].sort(),
      skills: [...(sel.skills || [])].sort(),
      education: [...(sel.education || [])].sort(),
      achievements: [...(sel.achievements || [])].sort(),
    });
  return norm(a) === norm(b);
}

function importData(data) {
  if (!data || typeof data !== "object" || !data.blocks || !data.resumes) {
    showToast("That doesn't look like a Resume Blocks backup file");
    return;
  }

  // idMap[type][oldId] = the local id that block now lives under, whether
  // it was newly added or matched an existing duplicate.
  const idMap = {};
  BLOCK_TYPES.forEach((type) => (idMap[type] = {}));

  let blocksAdded = 0;
  let blocksSkipped = 0;

  BLOCK_TYPES.forEach((type) => {
    const incoming = Array.isArray(data.blocks[type]) ? data.blocks[type] : [];
    if (!blocks[type]) blocks[type] = [];

    incoming.forEach((item) => {
      const incomingShort = normalizeForCompare(item.short);
      const incomingLong = normalizeForCompare(item.long);
      // Dedup by content, not by id — ids are randomly generated per
      // device, so the same block created on two devices never shares an id.
      const existing = blocks[type].find(
        (b) =>
          normalizeForCompare(b.short) === incomingShort &&
          normalizeForCompare(b.long) === incomingLong,
      );
      if (existing) {
        idMap[type][item.id] = existing.id;
        blocksSkipped++;
      } else {
        const newId = uid();
        blocks[type].push({
          id: newId,
          short: (item.short || "").trim(),
          long: (item.long || "").trim(),
        });
        idMap[type][item.id] = newId;
        blocksAdded++;
      }
    });
  });

  let resumesAdded = 0;
  let resumesSkipped = 0;
  const incomingResumes = Array.isArray(data.resumes) ? data.resumes : [];

  incomingResumes.forEach((r) => {
    const sel = r.selection || {};
    // Rewrite every block reference through idMap so the resume points at
    // this device's ids instead of the exporting device's ids.
    const remapped = {
      name: sel.name ? idMap.name[sel.name] || null : null,
      summary: sel.summary ? idMap.summary[sel.summary] || null : null,
      work: (sel.work || []).map((id) => idMap.work[id]).filter(Boolean),
      skills: (sel.skills || []).map((id) => idMap.skills[id]).filter(Boolean),
      education: (sel.education || [])
        .map((id) => idMap.education[id])
        .filter(Boolean),
      achievements: (sel.achievements || [])
        .map((id) => idMap.achievements[id])
        .filter(Boolean),
    };

    const title = (r.title || "Untitled Resume").trim();
    const isDuplicate = resumes.some(
      (existingResume) =>
        (existingResume.title || "").trim().toLowerCase() ===
          title.toLowerCase() && selectionsEqual(existingResume.selection, remapped),
    );

    if (isDuplicate) {
      resumesSkipped++;
      return;
    }

    resumes.push({
      id: uid(),
      title,
      createdAt: r.createdAt || Date.now(),
      selection: remapped,
      publicLink: r.publicLink || "",
    });
    resumesAdded++;
  });

  saveBlocks(blocks);
  saveResumes(resumes);
  render();
  showToast(
    `Imported ${blocksAdded} block(s), ${resumesAdded} resume(s) \u2014 ${
      blocksSkipped + resumesSkipped
    } duplicate(s) skipped`,
  );
}

/* ---------- Router ---------- */
function navigate(hash) {
  window.location.hash = hash;
}
window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", () => {
  if (!window.location.hash) window.location.hash = "#/menu";
  render();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
});

function render() {
  const hash = window.location.hash || "#/menu";
  const app = document.getElementById("app");
  app.innerHTML = "";

  if (hash === "#/menu") {
    app.appendChild(renderMenu());
  } else if (hash.startsWith("#/block/")) {
    const type = hash.split("/")[2];
    app.appendChild(renderBlockPage(type));
  } else if (hash === "#/resumes") {
    app.appendChild(renderResumesList());
  } else if (hash.startsWith("#/resume/")) {
    const id = hash.split("/")[2];
    app.appendChild(renderResumeBuilder(id === "new" ? null : id));
  } else {
    app.appendChild(renderMenu());
  }
}

/* ---------- Small UI helpers ---------- */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function")
      node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c === null || c === undefined) return;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return node;
}

function topbar({ title, onBack, right }) {
  const bar = el("div", { class: "topbar" });
  if (onBack)
    bar.appendChild(
      el("button", { class: "back-btn", onclick: onBack }, "\u2190"),
    );
  bar.appendChild(el("div", { class: "title" }, title));
  if (right) bar.appendChild(right);
  return bar;
}

function showToast(msg) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = el("div", { class: "toast" });
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("show"), 1600);
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showToast("Copied to clipboard"),
      () => fallbackCopy(text),
    );
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    showToast("Copied to clipboard");
  } catch (e) {
    showToast("Could not copy");
  }
  document.body.removeChild(ta);
}

/* ---------- Main Menu ---------- */
function renderMenu() {
  const wrap = el("div");
  wrap.appendChild(topbar({ title: "Resume Blocks" }));

  const content = el("div", { class: "content" });
  const list = el("div", { class: "menu-list" });

  BLOCK_TYPES.forEach((type) => {
    const count = blocks[type] ? blocks[type].length : 0;
    const item = el(
      "div",
      { class: "menu-item", onclick: () => navigate(`#/block/${type}`) },
      [
        el("div", {}, [
          el("div", { class: "label" }, LABELS[type]),
          el("div", { class: "count" }, `${count} saved`),
        ]),
        el(
          "button",
          {
            class: "plus-btn",
            onclick: (e) => {
              e.stopPropagation();
              navigate(`#/block/${type}`);
            },
          },
          "+",
        ),
      ],
    );
    list.appendChild(item);
  });

  content.appendChild(list);
  content.appendChild(
    el(
      "button",
      { class: "ready-btn", onclick: () => navigate("#/resumes") },
      "Ready Resumes",
    ),
  );

  const fileInput = el("input", {
    type: "file",
    accept: "application/json,.json",
    style: "display:none;",
  });
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleImportFile(file);
    fileInput.value = "";
  });

  const dataRow = el("div", { class: "data-actions" }, [
    el("button", { class: "data-btn", onclick: exportData }, "Export Data"),
    el(
      "button",
      { class: "data-btn", onclick: () => fileInput.click() },
      "Import Data",
    ),
    fileInput,
  ]);
  content.appendChild(dataRow);

  wrap.appendChild(content);
  return wrap;
}

/* ---------- Block Sub Page ---------- */
function renderBlockPage(type) {
  const wrap = el("div");
  wrap.appendChild(
    topbar({
      title: LABELS[type] || "Block",
      onBack: () => navigate("#/menu"),
    }),
  );
  const content = el("div", { class: "content" });

  const shortInput = el("textarea", {
    class: "short-input",
    placeholder: `Short version of ${LABELS[type]}...`,
  });
  const longInput = el("textarea", {
    class: "long-input",
    placeholder: `Long / detailed version of ${LABELS[type]}...`,
  });

  // Tracks which block (if any) is currently being edited on this page.
  let editingId = null;

  const submitBtn = el(
    "button",
    { class: "submit-btn", onclick: () => submit() },
    "Submit",
  );
  const cancelBtn = el(
    "button",
    {
      class: "submit-btn secondary-btn",
      style: "display:none;",
      onclick: () => exitEditMode(),
    },
    "Cancel",
  );

  function enterEditMode(item) {
    editingId = item.id;
    shortInput.value = item.short || "";
    longInput.value = item.long || "";
    submitBtn.textContent = "Update";
    cancelBtn.style.display = "inline-block";
    shortInput.focus();
  }

  function exitEditMode() {
    editingId = null;
    shortInput.value = "";
    longInput.value = "";
    submitBtn.textContent = "Submit";
    cancelBtn.style.display = "none";
  }

  function submit() {
    const shortVal = shortInput.value.trim();
    const longVal = longInput.value.trim();
    if (!shortVal && !longVal) return;
    if (!blocks[type]) blocks[type] = [];

    if (editingId) {
      const idx = blocks[type].findIndex((b) => b.id === editingId);
      if (idx !== -1) {
        blocks[type][idx] = {
          ...blocks[type][idx],
          short: shortVal,
          long: longVal,
        };
      }
    } else {
      blocks[type].push({ id: uid(), short: shortVal, long: longVal });
    }
    saveBlocks(blocks);
    render();
  }

  const form = el("div", { class: "field-group" }, [
    el("div", {}, [
      el("label", { class: "field-label" }, "Short version"),
      shortInput,
    ]),
    el("div", {}, [
      el("label", { class: "field-label" }, "Long version"),
      longInput,
    ]),
    el("div", { class: "form-btn-row" }, [submitBtn, cancelBtn]),
  ]);
  content.appendChild(form);

  content.appendChild(
    el("div", { class: "section-title" }, `Saved ${LABELS[type]} blocks`),
  );

  const items = blocks[type] || [];
  if (items.length === 0) {
    content.appendChild(
      el("div", { class: "empty-hint" }, "No blocks yet. Add one above."),
    );
  } else {
    items
      .slice()
      .reverse()
      .forEach((item) => {
        const textCol = el("div", { class: "block-text" });

        if (item.short) {
          textCol.appendChild(
            el("div", { class: "text-row" }, [
              el("div", { class: "short-line" }, item.short),
              copyIconBtn(() => item.short),
            ]),
          );
        } else {
          textCol.appendChild(
            el("div", { class: "short-line muted" }, "(no short version)"),
          );
        }

        if (item.long) {
          textCol.appendChild(
            el("div", { class: "text-row" }, [
              el("div", { class: "long-line" }, item.long),
              copyIconBtn(() => item.long),
            ]),
          );
        } else {
          textCol.appendChild(
            el("div", { class: "long-line muted" }, "(no long version)"),
          );
        }

        const actionsCol = kebabMenu([
          { label: "Edit", onClick: () => enterEditMode(item) },
          {
            label: "Delete",
            danger: true,
            onClick: () => {
              if (!confirm("Delete this block?")) return;
              if (editingId === item.id) exitEditMode();
              blocks[type] = blocks[type].filter((b) => b.id !== item.id);
              saveBlocks(blocks);
              render();
            },
          },
        ]);

        const card = el("div", { class: "block-card" }, [textCol, actionsCol]);
        content.appendChild(card);
      });
  }

  wrap.appendChild(content);
  return wrap;
}

/* Small copy-to-clipboard icon button used per short/long line.
   getText is a function so it always reads the latest value at click time. */
function copyIconBtn(getText) {
  return el(
    "button",
    {
      class: "copy-btn small",
      onclick: (e) => {
        copyToClipboard(getText() || "");
        e.currentTarget.classList.add("copied");
        setTimeout(() => e.currentTarget.classList.remove("copied"), 800);
      },
    },
    "\u2398",
  );
}

/* Kebab (\u22ee) menu button used to tuck Edit/Delete away per card.
   actions: [{ label, onClick, danger? }] */
function kebabMenu(actions) {
  const menu = el("div", { class: "kebab-menu" });
  actions.forEach((a) => {
    menu.appendChild(
      el(
        "button",
        {
          class: "kebab-item" + (a.danger ? " danger" : ""),
          onclick: (e) => {
            e.stopPropagation();
            closeAllKebabMenus();
            a.onClick();
          },
        },
        a.label,
      ),
    );
  });
  menu.style.display = "none";

  const btn = el(
    "button",
    {
      class: "kebab-btn",
      onclick: (e) => {
        e.stopPropagation();
        const isOpen = menu.style.display === "block";
        closeAllKebabMenus();
        menu.style.display = isOpen ? "none" : "block";
      },
    },
    "\u22EE",
  );

  return el("div", { class: "kebab-wrap" }, [btn, menu]);
}

function closeAllKebabMenus() {
  document.querySelectorAll(".kebab-menu").forEach((m) => {
    m.style.display = "none";
  });
}
document.addEventListener("click", closeAllKebabMenus);

/* ---------- Ready Resumes List ---------- */
function renderResumesList() {
  const wrap = el("div");
  const right = el(
    "button",
    { class: "icon-btn", onclick: () => navigate("#/resume/new") },
    "+",
  );
  wrap.appendChild(
    topbar({ title: "Ready Resumes", onBack: () => navigate("#/menu"), right }),
  );

  const content = el("div", { class: "content" });

  if (resumes.length === 0) {
    content.appendChild(
      el("div", { class: "empty-hint" }, "No resumes yet. Tap + to build one."),
    );
  } else {
    resumes
      .slice()
      .reverse()
      .forEach((resume) => {
        content.appendChild(renderResumeCard(resume));
      });
  }

  wrap.appendChild(content);
  return wrap;
}

function renderResumeCard(resume) {
  const card = el("div", { class: "resume-card" });
  const nameEl = el(
    "div",
    { class: "resume-name", onclick: () => navigate(`#/resume/${resume.id}`) },
    resume.title || "Untitled Resume",
  );
  card.appendChild(nameEl);

  const actions = el("div", { class: "resume-actions" }, [
    el(
      "button",
      { class: "action-btn", onclick: () => downloadPDF(resume) },
      "Download PDF",
    ),
    el(
      "button",
      { class: "action-btn secondary", onclick: () => downloadWord(resume) },
      "Download Word",
    ),
    el(
      "button",
      {
        class: "action-btn danger",
        onclick: () => {
          if (!confirm("Delete this resume?")) return;
          resumes = resumes.filter((r) => r.id !== resume.id);
          saveResumes(resumes);
          render();
        },
      },
      "Delete",
    ),
  ]);
  card.appendChild(actions);

  // Only lock the field if a link already exists. An empty field must stay
  // editable, otherwise there is no way to type the first link in.
  const hasLink = !!(resume.publicLink && resume.publicLink.trim());
  const linkInput = el("input", {
    type: "url",
    class: "link-input" + (hasLink ? " locked" : ""),
    placeholder: "Public link (paste after uploading)",
    value: resume.publicLink || "",
  });
  if (hasLink) linkInput.setAttribute("readonly", "readonly");

  const lock = () => {
    if (linkInput.value.trim()) {
      linkInput.setAttribute("readonly", "readonly");
      linkInput.classList.add("locked");
    }
  };
  const unlock = () => {
    linkInput.removeAttribute("readonly");
    linkInput.classList.remove("locked");
    linkInput.focus();
    linkInput.select();
  };

  const commitLink = () => {
    resume.publicLink = linkInput.value.trim();
    saveResumes(resumes);
    lock();
  };

  linkInput.addEventListener("click", () => {
    if (linkInput.hasAttribute("readonly") && resume.publicLink) {
      copyToClipboard(resume.publicLink);
    }
  });

  // Pointer events unify mouse + touch so the long-press timer only ever
  // fires once, instead of the old touchstart/mousedown combo double-firing
  // on mobile and leaving the field stuck in a bad state.
  let pressTimer = null;
  const startPress = () => {
    clearTimeout(pressTimer);
    pressTimer = setTimeout(unlock, 500);
  };
  const cancelPress = () => clearTimeout(pressTimer);
  linkInput.addEventListener("pointerdown", startPress);
  linkInput.addEventListener("pointerup", cancelPress);
  linkInput.addEventListener("pointerleave", cancelPress);
  linkInput.addEventListener("pointercancel", cancelPress);
  linkInput.addEventListener("blur", commitLink);
  linkInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") linkInput.blur();
  });

  card.appendChild(el("div", { class: "link-row" }, [linkInput]));
  return card;
}

/* ---------- Resume Builder ---------- */
function renderResumeBuilder(resumeId) {
  const isNew = !resumeId;
  let resume;
  if (isNew) {
    resume = {
      id: uid(),
      title: "",
      createdAt: Date.now(),
      selection: {
        name: null,
        summary: null,
        work: [],
        skills: [],
        education: [],
        achievements: [],
      },
      publicLink: "",
    };
  } else {
    const found = resumes.find((r) => r.id === resumeId);
    if (!found) {
      navigate("#/resumes");
      return el("div");
    }
    resume = JSON.parse(JSON.stringify(found));
  }
  return buildBuilderDom(resume, resume.title || "");
}

function buildBuilderDom(resume, titleValue) {
  const wrap = el("div");
  const titleInput = el("input", {
    type: "text",
    class: "title-input",
    placeholder: "Resume name",
    value: titleValue !== undefined ? titleValue : resume.title || "",
  });

  const save = () => {
    resume.title = titleInput.value.trim() || "Untitled Resume";
    const idx = resumes.findIndex((r) => r.id === resume.id);
    if (idx === -1) resumes.push(resume);
    else resumes[idx] = resume;
    saveResumes(resumes);
    navigate("#/resumes");
  };

  const right = el(
    "button",
    { class: "icon-btn check", onclick: save },
    "\u2713",
  );
  const bar = el("div", { class: "topbar" }, [
    el(
      "button",
      { class: "back-btn", onclick: () => navigate("#/resumes") },
      "\u2190",
    ),
    titleInput,
    right,
  ]);
  wrap.appendChild(bar);

  const content = el("div", { class: "content" });

  BLOCK_TYPES.forEach((type) => {
    const section = el("div", { class: "select-section" });
    const isSingle = !!SINGLE_SELECT[type];
    section.appendChild(
      el("div", { class: "section-header" }, [
        el("div", { class: "name" }, LABELS[type]),
        el("div", { class: "hint" }, isSingle ? "choose one" : "choose any"),
      ]),
    );

    const items = blocks[type] || [];
    if (items.length === 0) {
      section.appendChild(
        el(
          "div",
          { class: "empty-hint" },
          `No ${LABELS[type]} blocks yet. Add some from the main menu.`,
        ),
      );
    } else {
      items.forEach((item) => {
        const isSelected = isSingle
          ? resume.selection[type] === item.id
          : (resume.selection[type] || []).includes(item.id);

        const card = el("div", { class: "block-card" }, [
          el("div", { class: "block-text" }, [
            el(
              "div",
              { class: "short-line" },
              item.short || "(no short version)",
            ),
            el("div", { class: "long-line" }, item.long || "(no long version)"),
          ]),
          el(
            "button",
            {
              class: "select-check" + (isSelected ? " selected" : ""),
              onclick: () => {
                if (isSingle) {
                  resume.selection[type] =
                    resume.selection[type] === item.id ? null : item.id;
                } else {
                  const arr = resume.selection[type] || [];
                  resume.selection[type] = arr.includes(item.id)
                    ? arr.filter((x) => x !== item.id)
                    : [...arr, item.id];
                }
                const fresh = buildBuilderDom(resume, titleInput.value);
                wrap.replaceWith(fresh);
              },
            },
            isSelected ? "\u2713" : "",
          ),
        ]);
        section.appendChild(card);
      });
    }
    content.appendChild(section);
  });

  wrap.appendChild(content);
  return wrap;
}

/* ---------- Resume content assembly ---------- */
function getBlockById(type, id) {
  return (blocks[type] || []).find((b) => b.id === id);
}

function buildResumeSections(resume) {
  const sections = [];
  const nameBlock = resume.selection.name
    ? getBlockById("name", resume.selection.name)
    : null;
  const summaryBlock = resume.selection.summary
    ? getBlockById("summary", resume.selection.summary)
    : null;

  const name = nameBlock ? nameBlock.long || nameBlock.short : "";
  const summary = summaryBlock ? summaryBlock.long || summaryBlock.short : "";

  ["work", "skills", "education", "achievements"].forEach((type) => {
    const ids = resume.selection[type] || [];
    const texts = ids
      .map((id) => getBlockById(type, id))
      .filter(Boolean)
      .map((b) => b.long || b.short);
    sections.push({ label: LABELS[type], items: texts });
  });

  return { name, summary, sections };
}

/* ---------- PDF export ---------- */
function downloadPDF(resume) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast("PDF library failed to load");
    return;
  }

  const { jsPDF } = window.jspdf;
  const { name, summary, sections } = buildResumeSections(resume);

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 54;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  function ensureSpace(lineHeight) {
    if (y + lineHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  }

  function addHeading(text, size) {
    ensureSpace(size + 10);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.text(text, margin, y);
    y += size * 0.5 + 8;
  }

  function addParagraph(text, size) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    const paragraphs = String(text).split(/\n+/);
    paragraphs.forEach((para) => {
      if (!para.trim()) return;
      const lines = doc.splitTextToSize(para, maxWidth);
      lines.forEach((line) => {
        ensureSpace(size + 4);
        doc.text(line, margin, y);
        y += size + 4;
      });
    });
    y += 8;
  }

  addHeading(name || resume.title || "Resume", 22);
  if (summary) {
    addHeading("Summary", 13);
    addParagraph(summary, 11);
  }
  sections.forEach((sec) => {
    if (sec.items.length === 0) return;
    addHeading(sec.label, 13);
    sec.items.forEach((text) => addParagraph(text, 11));
  });

  doc.save(`${(resume.title || "resume").replace(/\s+/g, "_")}.pdf`);
}

/* ---------- Word (.doc) export ---------- */
function downloadWord(resume) {
  const { name, summary, sections } = buildResumeSections(resume);
  let bodyHtml = `<h1>${escapeHtml(name || resume.title || "Resume")}</h1>`;
  if (summary) {
    bodyHtml += `<h2>Summary</h2><p>${escapeHtml(summary).replace(/\n/g, "<br/>")}</p>`;
  }
  sections.forEach((sec) => {
    if (sec.items.length === 0) return;
    bodyHtml += `<h2>${escapeHtml(sec.label)}</h2>`;
    sec.items.forEach((text) => {
      bodyHtml += `<p>${escapeHtml(text).replace(/\n/g, "<br/>")}</p>`;
    });
  });

  const html = `<!DOCTYPE html><html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
  <head><meta charset='utf-8'><title>${escapeHtml(resume.title || "Resume")}</title></head>
  <body style="font-family:Georgia,serif;">${bodyHtml}</body></html>`;

  const blob = new Blob(["\ufeff", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(resume.title || "resume").replace(/\s+/g, "_")}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
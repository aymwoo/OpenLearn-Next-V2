// src/frontend.tsx
import React6 from "react";

// src/frontend/TeacherPanel.tsx
import React, { useState, useEffect, useCallback, useRef } from "react";
var STATUS_MAP = {
  draft: { label: "\u672A\u53D1\u5E03", color: "#9ca3af" },
  published: { label: "\u5DF2\u53D1\u5E03", color: "#22c55e" },
  archived: { label: "\u5DF2\u5F52\u6863", color: "#6b7280" }
};
var MODE_LABELS = {
  sdk: "SDK \u534F\u8BAE",
  ai_injected: "AI \u81EA\u52A8\u68C0\u6D4B",
  manual_selector: "CSS \u9009\u62E9\u5668",
  manual_js_var: "JS \u53D8\u91CF",
  manual_entry: "\u5B66\u751F\u624B\u52A8\u5F55\u5165"
};
function TeacherPanel({ ctx }) {
  const [coursewares, setCoursewares] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [scores, setScores] = useState([]);
  const [versions, setVersions] = useState([]);
  const [tab, setTab] = useState("preview");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ctx.invokeCommand("courseware.query", {
        search: search || void 0,
        status: statusFilter || void 0,
        limit: 100
      });
      setCoursewares(res.items || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [ctx, search, statusFilter]);
  useEffect(() => {
    loadList();
  }, [loadList]);
  const loadDetail = useCallback(async (id) => {
    try {
      const [detailRes, scoresRes] = await Promise.all([
        ctx.invokeCommand("courseware.get_detail", { id }),
        ctx.invokeCommand("courseware.query_scores", { courseware_id: id })
      ]);
      setDetail(detailRes);
      setScores(scoresRes.items || []);
      const verRes = await ctx.invokeCommand("courseware.query_versions", {
        courseware_key: detailRes.courseware_key
      });
      setVersions(verRes.items || []);
    } catch (e) {
      console.error(e);
    }
  }, [ctx]);
  useEffect(() => {
    if (selectedId) {
      loadDetail(selectedId);
    } else {
      setDetail(null);
      setScores([]);
      setVersions([]);
    }
  }, [selectedId, loadDetail]);
  const handlePublish = async (id, status) => {
    await ctx.invokeCommand("courseware.publish", { id, status });
    loadList();
    if (selectedId === id)
      loadDetail(id);
  };
  const handleDelete = async (id) => {
    if (!window.confirm("\u786E\u5B9A\u5220\u9664\u6B64\u8BFE\u4EF6\uFF1F\u6240\u6709\u7248\u672C\u3001\u6210\u7EE9\u548C\u6587\u4EF6\u5C06\u88AB\u6E05\u9664\u3002"))
      return;
    await ctx.invokeCommand("courseware.delete", { id });
    setSelectedId(null);
    loadList();
  };
  const handleExtractionUpdate = async (id, config) => {
    await ctx.invokeCommand("courseware.update_extraction", { id, extraction_config: config });
    if (selectedId === id)
      loadDetail(id);
  };
  const exportCSV = () => {
    if (scores.length === 0)
      return;
    const header = "\u5B66\u53F7,\u59D3\u540D,\u5F97\u5206,\u603B\u5206,\u6B63\u786E\u7387,\u91C7\u96C6\u6765\u6E90,\u7528\u65F6(\u79D2),\u63D0\u4EA4\u65F6\u95F4";
    const rows = scores.map(
      (s) => `${s.student_id},${s.student_name},${s.score},${s.total},${(s.score / s.total * 100).toFixed(1)}%,${s.submit_source},${s.time_spent},${s.submitted_at}`
    );
    const csv = "\uFEFF" + [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scores_${selectedId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", height: "100%", background: "#f8fafc" } }, /* @__PURE__ */ React.createElement("div", { style: { width: 300, minWidth: 300, borderRight: "1px solid #e5e7eb", display: "flex", flexDirection: "column", background: "#fff" } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "12px 16px", borderBottom: "1px solid #e5e7eb" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 15, fontWeight: 600, color: "#1e293b" } }, "\u8BFE\u4EF6\u5217\u8868"), /* @__PURE__ */ React.createElement(UploadButton, { ctx, onUploaded: loadList })), /* @__PURE__ */ React.createElement("input", { type: "text", placeholder: "\u{1F50D} \u641C\u7D22\u8BFE\u4EF6...", value: search, onChange: (e) => setSearch(e.target.value), style: inputStyle }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, marginTop: 8 } }, ["", "published", "draft"].map((s) => /* @__PURE__ */ React.createElement("button", { key: s, onClick: () => setStatusFilter(s), style: {
    ...filterBtnStyle,
    background: statusFilter === s ? "#3b82f6" : "#f1f5f9",
    color: statusFilter === s ? "#fff" : "#64748b"
  } }, s === "" ? "\u5168\u90E8" : s === "published" ? "\u5DF2\u53D1\u5E03" : "\u672A\u53D1\u5E03")))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, overflow: "auto" } }, loading && /* @__PURE__ */ React.createElement("div", { style: { padding: 24, textAlign: "center", color: "#94a3b8" } }, "\u52A0\u8F7D\u4E2D..."), coursewares.map((cw) => {
    const st = STATUS_MAP[cw.status] || STATUS_MAP.draft;
    return /* @__PURE__ */ React.createElement("div", { key: cw.id, onClick: () => setSelectedId(cw.id), style: {
      padding: "10px 16px",
      cursor: "pointer",
      borderBottom: "1px solid #f1f5f9",
      background: selectedId === cw.id ? "#eff6ff" : "transparent",
      borderLeft: selectedId === cw.id ? "3px solid #3b82f6" : "3px solid transparent"
    } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 3 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: st.color, display: "inline-block", flexShrink: 0 } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, fontWeight: 500, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, cw.title, cw.version > 1 && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "#94a3b8", marginLeft: 4 } }, "v", cw.version))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#94a3b8", paddingLeft: 12 } }, st.label, " \xB7 ", cw.created_at?.slice(0, 10), " \xB7 ", cw.stats.submissions, " \u4EFD\u63D0\u4EA4"));
  }), !loading && coursewares.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: 32, textAlign: "center", color: "#94a3b8", fontSize: 13 } }, "\u6682\u65E0\u8BFE\u4EF6"))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, overflow: "auto" } }, !detail ? /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#94a3b8", fontSize: 14 } }, "\u9009\u62E9\u5DE6\u4FA7\u8BFE\u4EF6\u67E5\u770B\u8BE6\u60C5") : /* @__PURE__ */ React.createElement("div", { style: { padding: 20 } }, /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 16 } }, /* @__PURE__ */ React.createElement("h2", { style: { margin: "0 0 6px", fontSize: 18, color: "#0f172a" } }, detail.title, detail.version > 1 && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "#94a3b8", marginLeft: 6 } }, "v", detail.version)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 12, alignItems: "center", fontSize: 12, color: "#64748b", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", null, "\u91C7\u96C6: ", /* @__PURE__ */ React.createElement("strong", null, MODE_LABELS[detail.extraction_config?.mode] || "\u672A\u77E5")), /* @__PURE__ */ React.createElement("span", null, "\u53CA\u683C\u7EBF: ", detail.pass_score, "\u5206"), /* @__PURE__ */ React.createElement("span", null, "\u521B\u5EFA\u4E8E ", detail.created_at?.slice(0, 10)), /* @__PURE__ */ React.createElement("span", { style: { padding: "1px 8px", borderRadius: 10, fontSize: 11, background: STATUS_MAP[detail.status]?.color + "20", color: STATUS_MAP[detail.status]?.color } }, STATUS_MAP[detail.status]?.label), detail.security_warnings?.length > 0 && /* @__PURE__ */ React.createElement("span", { style: { padding: "1px 8px", borderRadius: 10, fontSize: 11, background: "#fef3c7", color: "#92400e" } }, "\u26A0 ", detail.security_warnings.length, " \u4E2A\u5B89\u5168\u63D0\u793A"))), versions.length > 1 && /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 12, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "#94a3b8", marginRight: 4 } }, "\u7248\u672C:"), versions.map((v) => /* @__PURE__ */ React.createElement("button", { key: v.id, onClick: () => setSelectedId(v.id), style: {
    ...filterBtnStyle,
    background: v.id === detail.id ? "#3b82f6" : "#f1f5f9",
    color: v.id === detail.id ? "#fff" : "#64748b"
  } }, "v", v.version, " ", v.status === "published" ? "(\u53D1\u5E03)" : v.status === "archived" ? "(\u5F52\u6863)" : ""))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 16 } }, detail.status === "draft" ? /* @__PURE__ */ React.createElement("button", { onClick: () => handlePublish(detail.id, "published"), style: primaryBtnStyle }, "\u53D1\u5E03\u8BFE\u4EF6") : detail.status === "published" ? /* @__PURE__ */ React.createElement("button", { onClick: () => handlePublish(detail.id, "draft"), style: { ...primaryBtnStyle, background: "#6b7280" } }, "\u53D6\u6D88\u53D1\u5E03") : null, /* @__PURE__ */ React.createElement("button", { onClick: () => handleDelete(detail.id), style: dangerBtnStyle }, "\u5220\u9664\u8BFE\u4EF6")), detail.security_warnings?.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 16, padding: "10px 14px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, fontSize: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600, color: "#92400e", marginBottom: 4 } }, "\u26A0 \u5B89\u5168\u63D0\u793A\uFF08\u4E0D\u5F71\u54CD\u6B63\u5E38\u4F7F\u7528\uFF09"), detail.security_warnings.map((w, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { color: "#a16207", lineHeight: 1.6 } }, "\xB7 ", w))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", borderBottom: "1px solid #e5e7eb", marginBottom: 16 } }, ["preview", "scores", "settings"].map((t) => /* @__PURE__ */ React.createElement("button", { key: t, onClick: () => setTab(t), style: {
    padding: "8px 16px",
    border: "none",
    background: "none",
    cursor: "pointer",
    fontSize: 13,
    color: tab === t ? "#3b82f6" : "#64748b",
    borderBottom: tab === t ? "2px solid #3b82f6" : "2px solid transparent",
    fontWeight: tab === t ? 600 : 400
  } }, { preview: "\u9884\u89C8", scores: "\u6210\u7EE9", settings: "\u8BBE\u7F6E" }[t]))), tab === "preview" && /* @__PURE__ */ React.createElement(PreviewTab, { ctx, coursewareId: detail.id }), tab === "scores" && /* @__PURE__ */ React.createElement(ScoresTab, { detail, scores, onExportCSV: exportCSV }), tab === "settings" && /* @__PURE__ */ React.createElement(SettingsTab, { detail, onUpdate: handleExtractionUpdate }))));
}
function UploadButton({ ctx, onUploaded }) {
  const [show, setShow] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [passScore, setPassScore] = useState(60);
  const [htmlContent, setHtmlContent] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const handleFile = (file) => {
    if (!file.name.endsWith(".html") && !file.name.endsWith(".htm"))
      return;
    if (!title)
      setTitle(file.name.replace(/\.html?$/, ""));
    const reader = new FileReader();
    reader.onload = () => setHtmlContent(reader.result);
    reader.readAsText(file);
  };
  const handleUpload = async () => {
    if (!htmlContent || !title)
      return;
    setUploading(true);
    try {
      const res = await ctx.invokeCommand("courseware.upload", {
        title,
        description,
        html_content: htmlContent,
        pass_score: passScore
      });
      if (res.error) {
        alert(`\u4E0A\u4F20\u5931\u8D25: ${res.message || res.error}`);
      } else {
        setShow(false);
        setTitle("");
        setDescription("");
        setHtmlContent("");
        setPassScore(60);
        onUploaded();
        if (res.security_warnings?.length > 0) {
          alert(`\u8BFE\u4EF6\u5DF2\u4E0A\u4F20\uFF0C\u4F46\u68C0\u6D4B\u5230 ${res.security_warnings.length} \u4E2A\u5B89\u5168\u63D0\u793A:
${res.security_warnings.join("\n")}`);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setUploading(false);
    }
  };
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { onClick: () => setShow(true), style: { ...primaryBtnStyle, padding: "4px 12px", fontSize: 12 } }, "+ \u4E0A\u4F20"), show && /* @__PURE__ */ React.createElement("div", { style: modalOverlay, onClick: () => setShow(false) }, /* @__PURE__ */ React.createElement("div", { style: modalStyle, onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 } }, /* @__PURE__ */ React.createElement("h3", { style: { margin: 0, fontSize: 16 } }, "\u4E0A\u4F20\u65B0\u8BFE\u4EF6"), /* @__PURE__ */ React.createElement("button", { onClick: () => setShow(false), style: closeBtnStyle }, "\u2715")), /* @__PURE__ */ React.createElement(
    "div",
    {
      onDragOver: (e) => {
        e.preventDefault();
        setDragOver(true);
      },
      onDragLeave: () => setDragOver(false),
      onDrop: (e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files[0])
          handleFile(e.dataTransfer.files[0]);
      },
      onClick: () => fileInputRef.current?.click(),
      style: { border: `2px dashed ${dragOver ? "#3b82f6" : "#d1d5db"}`, borderRadius: 8, padding: 32, textAlign: "center", background: dragOver ? "#eff6ff" : "#f9fafb", marginBottom: 16, cursor: "pointer", transition: "all 0.15s" }
    },
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 28, marginBottom: 8 } }, "\u{1F4C2}"),
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "#64748b" } }, htmlContent ? "\u6587\u4EF6\u5DF2\u52A0\u8F7D" : "\u62D6\u62FD HTML \u6587\u4EF6\u5230\u6B64\u5904\uFF0C\u6216\u70B9\u51FB\u9009\u62E9"),
    htmlContent && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#22c55e", marginTop: 4 } }, "\u2713 ", (htmlContent.length / 1024).toFixed(1), " KB")
  ), /* @__PURE__ */ React.createElement("input", { ref: fileInputRef, type: "file", accept: ".html,.htm", style: { display: "none" }, onChange: (e) => {
    if (e.target.files?.[0])
      handleFile(e.target.files?.[0]);
  } }), /* @__PURE__ */ React.createElement("label", { style: labelStyle }, "\u8BFE\u4EF6\u540D\u79F0"), /* @__PURE__ */ React.createElement("input", { value: title, onChange: (e) => setTitle(e.target.value), style: inputStyle, placeholder: "\u8F93\u5165\u8BFE\u4EF6\u540D\u79F0" }), /* @__PURE__ */ React.createElement("label", { style: labelStyle }, "\u63CF\u8FF0"), /* @__PURE__ */ React.createElement("textarea", { value: description, onChange: (e) => setDescription(e.target.value), style: { ...inputStyle, height: 60, resize: "vertical" }, placeholder: "\u8BFE\u4EF6\u63CF\u8FF0\uFF08\u53EF\u9009\uFF09" }), /* @__PURE__ */ React.createElement("label", { style: labelStyle }, "\u53CA\u683C\u7EBF"), /* @__PURE__ */ React.createElement("input", { type: "number", value: passScore, onChange: (e) => setPassScore(Number(e.target.value)), style: { ...inputStyle, width: 100 }, min: 0, max: 1e3 }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 } }, /* @__PURE__ */ React.createElement("button", { onClick: () => setShow(false), style: { ...primaryBtnStyle, background: "#e5e7eb", color: "#374151" } }, "\u53D6\u6D88"), /* @__PURE__ */ React.createElement("button", { onClick: handleUpload, disabled: !htmlContent || !title || uploading, style: { ...primaryBtnStyle, opacity: !htmlContent || !title ? 0.5 : 1 } }, uploading ? "\u4E0A\u4F20\u4E2D..." : "\u786E\u8BA4\u4E0A\u4F20")))));
}
function PreviewTab({ ctx, coursewareId }) {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [inspectMode, setInspectMode] = useState(false);
  const [copiedSelector, setCopiedSelector] = useState("");
  const iframeRef = useRef(null);
  useEffect(() => {
    setLoading(true);
    ctx.invokeCommand("courseware.get_html", { id: coursewareId }).then((res) => {
      setHtml(res.html || "");
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [ctx, coursewareId]);
  useEffect(() => {
    if (!inspectMode || !html)
      return;
    const iframe = iframeRef.current;
    if (!iframe)
      return;
    const tryInject = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc)
          return;
        const style = doc.createElement("style");
        style.id = "openlearn-inspect-style";
        style.textContent = `
          .openlearn-inspect-hover { outline: 2px solid #3b82f6 !important; outline-offset: 1px; background: rgba(59,130,246,0.08) !important; }
          .openlearn-inspect-tooltip { position: fixed; z-index: 99999; background: #1e293b; color: #fff; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-family: monospace; pointer-events: none; max-width: 320px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        `;
        doc.head.appendChild(style);
        let tooltip = null;
        const getSelector = (el) => {
          if (el.id)
            return `#${el.id}`;
          const path = [];
          let current = el;
          while (current && current !== doc.body && current !== doc.documentElement) {
            let selector = current.tagName.toLowerCase();
            if (current.className && typeof current.className === "string") {
              const cls = current.className.trim().split(/\s+/).slice(0, 2).join(".");
              if (cls)
                selector += "." + cls;
            }
            path.unshift(selector);
            current = current.parentElement;
            if (path.length > 3)
              break;
          }
          return path.join(" > ");
        };
        const onOver = (e) => {
          const target = e.target;
          if (target === doc.body || target === doc.documentElement)
            return;
          target.classList.add("openlearn-inspect-hover");
          if (!tooltip) {
            tooltip = doc.createElement("div");
            tooltip.className = "openlearn-inspect-tooltip";
            doc.body.appendChild(tooltip);
          }
          tooltip.textContent = getSelector(target);
          tooltip.style.left = e.pageX + 12 + "px";
          tooltip.style.top = e.pageY - 30 + "px";
        };
        const onOut = (e) => {
          e.target.classList.remove("openlearn-inspect-hover");
          if (tooltip)
            tooltip.textContent = "";
        };
        const onClick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const sel = getSelector(e.target);
          navigator.clipboard.writeText(sel).then(() => {
            setCopiedSelector(sel);
            setTimeout(() => setCopiedSelector(""), 2e3);
          });
        };
        doc.addEventListener("mouseover", onOver, true);
        doc.addEventListener("mouseout", onOut, true);
        doc.addEventListener("click", onClick, true);
        return () => {
          doc.removeEventListener("mouseover", onOver, true);
          doc.removeEventListener("mouseout", onOut, true);
          doc.removeEventListener("click", onClick, true);
          const s = doc.getElementById("openlearn-inspect-style");
          if (s)
            s.remove();
          if (tooltip)
            tooltip.remove();
        };
      } catch (_) {
      }
    };
    const timer = setTimeout(tryInject, 500);
    return () => clearTimeout(timer);
  }, [inspectMode, html]);
  if (loading)
    return /* @__PURE__ */ React.createElement("div", { style: { color: "#94a3b8", padding: 20 } }, "\u52A0\u8F7D\u4E2D...");
  if (!html)
    return /* @__PURE__ */ React.createElement("div", { style: { color: "#94a3b8", padding: 20 } }, "\u65E0\u6CD5\u52A0\u8F7D\u8BFE\u4EF6\u5185\u5BB9");
  return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setInspectMode(!inspectMode),
      style: {
        ...primaryBtnStyle,
        background: inspectMode ? "#f59e0b" : "#f1f5f9",
        color: inspectMode ? "#fff" : "#64748b",
        fontSize: 12,
        padding: "4px 12px"
      }
    },
    inspectMode ? "\u9000\u51FA\u68C0\u67E5" : "\u{1F50D} \u68C0\u67E5\u6A21\u5F0F"
  ), copiedSelector && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "#22c55e" } }, "\u5DF2\u590D\u5236: ", copiedSelector)), /* @__PURE__ */ React.createElement(
    "iframe",
    {
      ref: iframeRef,
      srcDoc: html,
      sandbox: "allow-scripts allow-same-origin",
      style: {
        width: "100%",
        height: 500,
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        background: "#fff",
        pointerEvents: inspectMode ? "auto" : "auto"
      }
    }
  ));
}
function ScoresTab({ detail, scores, onExportCSV }) {
  const s = detail.stats;
  return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 } }, [
    { label: "\u63D0\u4EA4\u4EBA\u6570", value: s.submissions },
    { label: "\u5E73\u5747\u5206", value: s.avg_score },
    { label: "\u6700\u9AD8\u5206", value: s.max_score },
    { label: "\u6700\u4F4E\u5206", value: s.min_score },
    { label: "\u53CA\u683C\u7387", value: s.pass_rate + "%" }
  ].map((stat) => /* @__PURE__ */ React.createElement("div", { key: stat.label, style: { background: "#f8fafc", borderRadius: 8, padding: "12px 16px", border: "1px solid #e5e7eb" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#94a3b8", marginBottom: 4 } }, stat.label), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 20, fontWeight: 700, color: "#1e293b" } }, stat.value)))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14, fontWeight: 600, color: "#374151" } }, "\u6210\u7EE9\u660E\u7EC6"), /* @__PURE__ */ React.createElement("button", { onClick: onExportCSV, style: { ...primaryBtnStyle, padding: "4px 12px", fontSize: 12 } }, "\u5BFC\u51FA CSV")), /* @__PURE__ */ React.createElement("div", { style: { overflow: "auto" } }, /* @__PURE__ */ React.createElement("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 12 } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { style: { background: "#f8fafc", borderBottom: "1px solid #e5e7eb" } }, /* @__PURE__ */ React.createElement("th", { style: thStyle }, "\u5B66\u53F7"), /* @__PURE__ */ React.createElement("th", { style: thStyle }, "\u59D3\u540D"), /* @__PURE__ */ React.createElement("th", { style: thStyle }, "\u5F97\u5206"), /* @__PURE__ */ React.createElement("th", { style: thStyle }, "\u603B\u5206"), /* @__PURE__ */ React.createElement("th", { style: thStyle }, "\u6B63\u786E\u7387"), /* @__PURE__ */ React.createElement("th", { style: thStyle }, "\u6765\u6E90"), /* @__PURE__ */ React.createElement("th", { style: thStyle }, "\u7528\u65F6"), /* @__PURE__ */ React.createElement("th", { style: thStyle }, "\u63D0\u4EA4\u65F6\u95F4"))), /* @__PURE__ */ React.createElement("tbody", null, scores.map((s2) => /* @__PURE__ */ React.createElement("tr", { key: s2.id, style: { borderBottom: "1px solid #f1f5f9" } }, /* @__PURE__ */ React.createElement("td", { style: tdStyle }, s2.student_id), /* @__PURE__ */ React.createElement("td", { style: tdStyle }, s2.student_name), /* @__PURE__ */ React.createElement("td", { style: tdStyle }, s2.score), /* @__PURE__ */ React.createElement("td", { style: tdStyle }, s2.total), /* @__PURE__ */ React.createElement("td", { style: tdStyle }, (s2.score / s2.total * 100).toFixed(1), "%"), /* @__PURE__ */ React.createElement("td", { style: tdStyle }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, padding: "1px 6px", borderRadius: 4, background: s2.submit_source === "sdk" ? "#dcfce7" : "#fef3c7", color: s2.submit_source === "sdk" ? "#166534" : "#92400e" } }, s2.submit_source)), /* @__PURE__ */ React.createElement("td", { style: tdStyle }, s2.time_spent ? `${Math.floor(s2.time_spent / 60)}\u5206${s2.time_spent % 60}\u79D2` : "-"), /* @__PURE__ */ React.createElement("td", { style: tdStyle }, s2.submitted_at?.replace("T", " ").slice(0, 19)))), scores.length === 0 && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 8, style: { ...tdStyle, textAlign: "center", color: "#94a3b8", padding: 24 } }, "\u6682\u65E0\u6210\u7EE9\u6570\u636E"))))));
}
function SettingsTab({ detail, onUpdate }) {
  const [mode, setMode] = useState(detail.extraction_config?.mode || "sdk");
  const [scoreSelector, setScoreSelector] = useState(detail.extraction_config?.manual_config?.scoreSelector || detail.extraction_config?.ai_analysis?.scoreSelector || "");
  const [totalSelector, setTotalSelector] = useState(detail.extraction_config?.manual_config?.totalSelector || detail.extraction_config?.ai_analysis?.totalSelector || "");
  const [triggerSelector, setTriggerSelector] = useState(detail.extraction_config?.manual_config?.triggerSelector || detail.extraction_config?.ai_analysis?.triggerSelector || "");
  const [jsVarName, setJsVarName] = useState(detail.extraction_config?.manual_config?.jsVarName || detail.extraction_config?.ai_analysis?.jsVarName || "");
  const [saving, setSaving] = useState(false);
  const buildConfig = () => {
    switch (mode) {
      case "sdk":
        return { mode: "sdk" };
      case "ai_injected":
        return { mode: "ai_injected", ai_analysis: { scoreSource: "dom", scoreSelector, totalSelector, triggerSelector, triggerEvent: "button_click", confidence: 0.85 } };
      case "manual_selector":
        return { mode: "manual_selector", manual_config: { scoreSelector, totalSelector, triggerSelector, triggerEvent: "button_click" } };
      case "manual_js_var":
        return { mode: "manual_js_var", manual_config: { jsVarName } };
      case "manual_entry":
        return { mode: "manual_entry" };
      default:
        return { mode: "sdk" };
    }
  };
  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate(detail.id, buildConfig());
    } finally {
      setSaving(false);
    }
  };
  return /* @__PURE__ */ React.createElement("div", { style: { maxWidth: 500 } }, /* @__PURE__ */ React.createElement("label", { style: labelStyle }, "\u6210\u7EE9\u91C7\u96C6\u65B9\u5F0F"), /* @__PURE__ */ React.createElement("select", { value: mode, onChange: (e) => setMode(e.target.value), style: { ...inputStyle, width: "100%" } }, /* @__PURE__ */ React.createElement("option", { value: "sdk" }, "SDK \u534F\u8BAE \u2014 \u8BFE\u4EF6\u8C03\u7528 OpenLearn.submit()"), /* @__PURE__ */ React.createElement("option", { value: "ai_injected" }, "AI \u81EA\u52A8\u68C0\u6D4B \u2014 \u7CFB\u7EDF\u5206\u6790\u5E76\u6CE8\u5165\u63D0\u53D6\u811A\u672C"), /* @__PURE__ */ React.createElement("option", { value: "manual_selector" }, "CSS \u9009\u62E9\u5668 \u2014 \u624B\u52A8\u6307\u5B9A\u6210\u7EE9 DOM \u5143\u7D20"), /* @__PURE__ */ React.createElement("option", { value: "manual_js_var" }, "JS \u53D8\u91CF \u2014 \u6307\u5B9A\u5168\u5C40\u53D8\u91CF\u540D"), /* @__PURE__ */ React.createElement("option", { value: "manual_entry" }, "\u5B66\u751F\u624B\u52A8\u5F55\u5165 \u2014 \u65E0\u81EA\u52A8\u91C7\u96C6")), (mode === "manual_selector" || mode === "ai_injected") && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement("label", { style: labelStyle }, "\u6210\u7EE9\u5143\u7D20\u9009\u62E9\u5668"), /* @__PURE__ */ React.createElement("input", { value: scoreSelector, onChange: (e) => setScoreSelector(e.target.value), style: inputStyle, placeholder: "\u4F8B\u5982\uFF1A#result .score-value" }), /* @__PURE__ */ React.createElement("label", { style: labelStyle }, "\u603B\u5206\u5143\u7D20\u9009\u62E9\u5668"), /* @__PURE__ */ React.createElement("input", { value: totalSelector, onChange: (e) => setTotalSelector(e.target.value), style: inputStyle, placeholder: "\u4F8B\u5982\uFF1A#result .total-value\uFF08\u53EF\u9009\uFF09" }), /* @__PURE__ */ React.createElement("label", { style: labelStyle }, "\u89E6\u53D1\u5143\u7D20\u9009\u62E9\u5668"), /* @__PURE__ */ React.createElement("input", { value: triggerSelector, onChange: (e) => setTriggerSelector(e.target.value), style: inputStyle, placeholder: "\u4F8B\u5982\uFF1A#submit-btn" }), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#94a3b8", marginTop: 4 } }, "\u{1F4A1} \u5728\u9884\u89C8 Tab \u4E2D\u5F00\u542F\u300C\u68C0\u67E5\u6A21\u5F0F\u300D\uFF0C\u60AC\u505C\u5143\u7D20\u5373\u53EF\u590D\u5236\u9009\u62E9\u5668")), mode === "manual_js_var" && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement("label", { style: labelStyle }, "JS \u5168\u5C40\u53D8\u91CF\u540D"), /* @__PURE__ */ React.createElement("input", { value: jsVarName, onChange: (e) => setJsVarName(e.target.value), style: inputStyle, placeholder: "\u4F8B\u5982\uFF1Awindow.__score" })), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 16 } }, /* @__PURE__ */ React.createElement("button", { onClick: handleSave, disabled: saving, style: primaryBtnStyle }, saving ? "\u4FDD\u5B58\u4E2D..." : "\u4FDD\u5B58\u914D\u7F6E")));
}
var inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
  background: "#fff"
};
var primaryBtnStyle = {
  padding: "6px 16px",
  border: "none",
  borderRadius: 6,
  background: "#3b82f6",
  color: "#fff",
  fontSize: 13,
  cursor: "pointer",
  fontWeight: 500
};
var dangerBtnStyle = {
  ...primaryBtnStyle,
  background: "#ef4444"
};
var filterBtnStyle = {
  padding: "3px 10px",
  border: "none",
  borderRadius: 14,
  fontSize: 11,
  cursor: "pointer",
  fontWeight: 500
};
var labelStyle = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#374151",
  marginBottom: 4,
  marginTop: 10
};
var thStyle = {
  padding: "8px 10px",
  textAlign: "left",
  fontWeight: 600,
  color: "#374151",
  fontSize: 11,
  whiteSpace: "nowrap"
};
var tdStyle = {
  padding: "8px 10px",
  color: "#4b5563",
  fontSize: 12
};
var modalOverlay = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1e3
};
var modalStyle = {
  background: "#fff",
  borderRadius: 12,
  padding: 24,
  width: 480,
  maxHeight: "80vh",
  overflow: "auto",
  boxShadow: "0 20px 60px rgba(0,0,0,0.15)"
};
var closeBtnStyle = {
  background: "none",
  border: "none",
  fontSize: 18,
  cursor: "pointer",
  color: "#94a3b8",
  padding: 0
};

// src/frontend/DashboardWidget.tsx
import React2, { useState as useState2, useEffect as useEffect2 } from "react";
function DashboardWidget({ ctx }) {
  const [stats, setStats] = useState2(null);
  useEffect2(() => {
    ctx.invokeCommand("courseware.dashboard_stats").then(setStats).catch(console.error);
  }, [ctx]);
  if (!stats) {
    return /* @__PURE__ */ React2.createElement("div", { style: cardStyle }, /* @__PURE__ */ React2.createElement("div", { style: { fontSize: 13, color: "#94a3b8", textAlign: "center", padding: 20 } }, "\u52A0\u8F7D\u4E2D..."));
  }
  const items = [
    ["\u8BFE\u4EF6\u603B\u6570", String(stats.total_coursewares), "\u{1F4DA}"],
    ["\u5DF2\u53D1\u5E03", String(stats.published_coursewares), "\u{1F4E2}"],
    ["\u6210\u7EE9\u63D0\u4EA4", String(stats.total_submissions), "\u{1F4DD}"],
    ["\u5747\u5206", String(stats.avg_score || "-"), "\u{1F4CA}"]
  ];
  return /* @__PURE__ */ React2.createElement("div", { style: cardStyle }, /* @__PURE__ */ React2.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 } }, /* @__PURE__ */ React2.createElement("span", { style: { fontSize: 16 } }, "\u{1F4CA}"), /* @__PURE__ */ React2.createElement("span", { style: { fontSize: 13, fontWeight: 600, color: "#1e293b" } }, "\u8BFE\u4EF6\u4E2D\u5FC3")), /* @__PURE__ */ React2.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 } }, items.map(([label, value, icon]) => /* @__PURE__ */ React2.createElement("div", { key: label, style: { textAlign: "center", background: "#f8fafc", borderRadius: 6, padding: "8px 4px" } }, /* @__PURE__ */ React2.createElement("div", { style: { fontSize: 12, color: "#94a3b8" } }, icon, " ", label), /* @__PURE__ */ React2.createElement("div", { style: { fontSize: 16, fontWeight: 700, color: "#1e293b" } }, value)))));
}
var cardStyle = {
  background: "#fff",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  padding: 14
};

// src/frontend/StudentTool.tsx
import React3, { useState as useState3, useEffect as useEffect3, useCallback as useCallback2 } from "react";
var COURSEWARE_ICONS = ["\u{1F9EC}", "\u{1F4D0}", "\u26A1", "\u{1F4D6}", "\u{1F52C}", "\u{1F30D}", "\u{1F4CA}", "\u{1F3AF}", "\u{1F9EE}", "\u{1F4BB}"];
function StudentTool({ ctx, studentId, onOpenFullscreen }) {
  const [coursewares, setCoursewares] = useState3([]);
  const [scores, setScores] = useState3(/* @__PURE__ */ new Map());
  const [loading, setLoading] = useState3(true);
  const loadData = useCallback2(async () => {
    setLoading(true);
    try {
      const [cwRes] = await Promise.all([
        ctx.invokeCommand("courseware.query", { status: "published", limit: 100 })
      ]);
      const items = cwRes.items || [];
      setCoursewares(items);
      if (studentId) {
        const scoreMap = /* @__PURE__ */ new Map();
        await Promise.all(items.map(async (cw) => {
          try {
            const sRes = await ctx.invokeCommand("courseware.query_scores", {
              courseware_id: cw.id,
              student_id: studentId
            });
            if (sRes.items?.length > 0) {
              scoreMap.set(cw.id, sRes.items[0]);
            }
          } catch (_) {
          }
        }));
        setScores(scoreMap);
      }
    } catch (e) {
      console.error("StudentTool loadData failed", e);
    } finally {
      setLoading(false);
    }
  }, [ctx, studentId]);
  useEffect3(() => {
    loadData();
  }, [loadData]);
  const getStatus = (cw) => {
    const s = scores.get(cw.id);
    if (s)
      return { label: "\u2705 \u5DF2\u5B8C\u6210", action: "\u67E5\u770B\u8BE6\u60C5", color: "#22c55e", bg: "#f0fdf4" };
    return { label: "\u{1F4CB} \u672A\u5F00\u59CB", action: "\u5F00\u59CB\u5B66\u4E60", color: "#3b82f6", bg: "#eff6ff" };
  };
  if (loading) {
    return /* @__PURE__ */ React3.createElement("div", { style: { padding: 32, textAlign: "center", color: "#94a3b8" } }, "\u52A0\u8F7D\u8BFE\u4EF6\u5217\u8868...");
  }
  if (coursewares.length === 0) {
    return /* @__PURE__ */ React3.createElement("div", { style: { padding: 48, textAlign: "center", color: "#94a3b8" } }, /* @__PURE__ */ React3.createElement("div", { style: { fontSize: 36, marginBottom: 12 } }, "\u{1F4DA}"), /* @__PURE__ */ React3.createElement("div", { style: { fontSize: 14 } }, "\u6682\u65E0\u53EF\u7528\u8BFE\u4EF6"), /* @__PURE__ */ React3.createElement("div", { style: { fontSize: 12, marginTop: 4 } }, "\u7B49\u5F85\u6559\u5E08\u53D1\u5E03\u8BFE\u4EF6"));
  }
  return /* @__PURE__ */ React3.createElement("div", { style: { padding: 16 } }, /* @__PURE__ */ React3.createElement("h2", { style: { fontSize: 16, fontWeight: 600, color: "#1e293b", margin: "0 0 16px" } }, "\u{1F4DA} \u6211\u7684\u8BFE\u4EF6"), /* @__PURE__ */ React3.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 } }, coursewares.map((cw, i) => {
    const st = getStatus(cw);
    const rowScore = scores.get(cw.id);
    return /* @__PURE__ */ React3.createElement(
      "div",
      {
        key: cw.id,
        style: {
          background: "#fff",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          transition: "box-shadow 0.15s",
          cursor: "pointer"
        },
        onMouseEnter: (e) => e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)",
        onMouseLeave: (e) => e.currentTarget.style.boxShadow = "none"
      },
      /* @__PURE__ */ React3.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" } }, /* @__PURE__ */ React3.createElement("span", { style: { fontSize: 28 } }, COURSEWARE_ICONS[i % COURSEWARE_ICONS.length]), /* @__PURE__ */ React3.createElement("span", { style: {
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 10,
        background: st.bg,
        color: st.color,
        fontWeight: 500
      } }, st.label)),
      /* @__PURE__ */ React3.createElement("div", null, /* @__PURE__ */ React3.createElement("div", { style: { fontSize: 14, fontWeight: 600, color: "#1e293b", marginBottom: 2 } }, cw.title), cw.description && /* @__PURE__ */ React3.createElement("div", { style: { fontSize: 11, color: "#94a3b8" } }, cw.description.slice(0, 60))),
      rowScore && /* @__PURE__ */ React3.createElement("div", { style: { fontSize: 12, color: "#64748b" } }, "\u5F97\u5206: ", /* @__PURE__ */ React3.createElement("strong", null, rowScore.score, "/", rowScore.total), "\xA0(", (rowScore.score / rowScore.total * 100).toFixed(0), "%)"),
      /* @__PURE__ */ React3.createElement(
        "button",
        {
          onClick: () => onOpenFullscreen(cw.id),
          style: {
            width: "100%",
            padding: "8px 0",
            border: "none",
            borderRadius: 6,
            background: st.color,
            color: "#fff",
            fontSize: 13,
            cursor: "pointer",
            fontWeight: 500,
            marginTop: "auto"
          }
        },
        st.action
      )
    );
  })));
}

// src/frontend/StudentFullscreen.tsx
import React5, { useState as useState4, useEffect as useEffect4, useRef as useRef2, useCallback as useCallback3 } from "react";

// src/frontend/ScoreOverlay.tsx
import React4 from "react";
function ScoreOverlay({ score, total, timeSpent, onBack, onRetry }) {
  const rate = total > 0 ? score / total * 100 : 0;
  const minutes = Math.floor(timeSpent / 60);
  const seconds = timeSpent % 60;
  const accentColor = rate >= 90 ? "#22c55e" : rate >= 70 ? "#f59e0b" : "#ef4444";
  return /* @__PURE__ */ React4.createElement("div", { style: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100
  } }, /* @__PURE__ */ React4.createElement("div", { style: {
    background: "#fff",
    borderRadius: 16,
    padding: "36px 48px",
    textAlign: "center",
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
    maxWidth: 400
  } }, /* @__PURE__ */ React4.createElement("div", { style: { fontSize: 48, marginBottom: 8 } }, rate >= 90 ? "\u{1F389}" : rate >= 70 ? "\u{1F44D}" : "\u{1F4DA}"), /* @__PURE__ */ React4.createElement("h2", { style: { margin: "0 0 4px", fontSize: 18, color: "#1e293b" } }, "\u8BFE\u4EF6\u5B8C\u6210"), /* @__PURE__ */ React4.createElement("div", { style: {
    margin: "20px 0",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    background: "#f8fafc",
    borderRadius: 12,
    padding: "20px"
  } }, /* @__PURE__ */ React4.createElement("div", { style: { fontSize: 36, fontWeight: 700, color: accentColor } }, score, /* @__PURE__ */ React4.createElement("span", { style: { fontSize: 18, fontWeight: 400, color: "#94a3b8" } }, " / ", total)), /* @__PURE__ */ React4.createElement("div", { style: { fontSize: 13, color: "#64748b" } }, "\u6B63\u786E\u7387 ", rate.toFixed(0), "%"), /* @__PURE__ */ React4.createElement("div", { style: { fontSize: 12, color: "#94a3b8" } }, "\u7528\u65F6 ", minutes, " \u5206 ", seconds, " \u79D2")), /* @__PURE__ */ React4.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "center" } }, /* @__PURE__ */ React4.createElement(
    "button",
    {
      onClick: onBack,
      style: {
        padding: "8px 20px",
        border: "1px solid #d1d5db",
        borderRadius: 8,
        background: "#fff",
        color: "#374151",
        fontSize: 13,
        cursor: "pointer"
      }
    },
    "\u8FD4\u56DE\u5217\u8868"
  ), /* @__PURE__ */ React4.createElement(
    "button",
    {
      onClick: onRetry,
      style: {
        padding: "8px 20px",
        border: "none",
        borderRadius: 8,
        background: "#3b82f6",
        color: "#fff",
        fontSize: 13,
        cursor: "pointer",
        fontWeight: 500
      }
    },
    "\u518D\u8BD5\u4E00\u6B21"
  ))));
}

// src/frontend/StudentFullscreen.tsx
function StudentFullscreen({ ctx, coursewareId, studentId, studentName, onBack }) {
  const [html, setHtml] = useState4("");
  const [loading, setLoading] = useState4(true);
  const [headerVisible, setHeaderVisible] = useState4(true);
  const [scoreResult, setScoreResult] = useState4(null);
  const [submitted, setSubmitted] = useState4(false);
  const [startTime] = useState4(Date.now());
  const [errorMsg, setErrorMsg] = useState4("");
  const hideTimerRef = useRef2(null);
  const heartbeatRef = useRef2(null);
  const submittedRef = useRef2(false);
  submittedRef.current = submitted;
  useEffect4(() => {
    setLoading(true);
    ctx.invokeCommand("courseware.get_html", { id: coursewareId }).then((res) => {
      if (res.error) {
        setErrorMsg(`\u8BFE\u4EF6\u52A0\u8F7D\u5931\u8D25: ${res.error}`);
      } else {
        setHtml(res.html || "");
      }
      setLoading(false);
    }).catch((e) => {
      setErrorMsg(`\u8BFE\u4EF6\u52A0\u8F7D\u5931\u8D25: ${e.message}`);
      setLoading(false);
    });
  }, [ctx, coursewareId]);
  const resetHideTimer = useCallback3(() => {
    setHeaderVisible(true);
    if (hideTimerRef.current)
      clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setHeaderVisible(false), 3e3);
  }, []);
  useEffect4(() => {
    resetHideTimer();
    return () => {
      if (hideTimerRef.current)
        clearTimeout(hideTimerRef.current);
    };
  }, [resetHideTimer]);
  useEffect4(() => {
    heartbeatRef.current = setInterval(() => {
      ctx.invokeCommand("courseware.heartbeat", {
        courseware_id: coursewareId,
        student_id: studentId,
        progress_data: { elapsed: Math.floor((Date.now() - startTime) / 1e3) }
      }).catch(() => {
      });
    }, 3e4);
    return () => {
      if (heartbeatRef.current)
        clearInterval(heartbeatRef.current);
    };
  }, [ctx, coursewareId, studentId]);
  useEffect4(() => {
    const handleBeforeUnload = () => {
      if (!submittedRef.current) {
        ctx.invokeCommand("courseware.heartbeat", {
          courseware_id: coursewareId,
          student_id: studentId,
          progress_data: { closing: true, elapsed: Math.floor((Date.now() - startTime) / 1e3) }
        }).catch(() => {
        });
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [ctx, coursewareId, studentId]);
  useEffect4(() => {
    const handleMessage = async (event) => {
      const data = event.data;
      if (!data || typeof data.type !== "string")
        return;
      if (data.source !== "openlearn-cw-sdk" && data.source !== "ai_injected")
        return;
      switch (data.type) {
        case "courseware:score":
          if (submittedRef.current)
            break;
          {
            const { score, total, detail } = data.payload || {};
            if (typeof score === "number" && total > 0) {
              setScoreResult({ score, total, detail });
              await submitScore(score, total, detail, data.source);
            }
          }
          break;
        case "courseware:complete":
          if (!submittedRef.current) {
            setScoreResult({ score: 0, total: 0 });
          }
          break;
        case "courseware:heartbeat":
          break;
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [coursewareId, studentId, studentName, ctx]);
  const submitScore = async (score, total, detail, source) => {
    if (submittedRef.current)
      return;
    setSubmitted(true);
    submittedRef.current = true;
    try {
      await ctx.invokeCommand("courseware.submit_score", {
        courseware_id: coursewareId,
        student_id: studentId,
        student_name: studentName,
        score,
        total,
        detail,
        submit_source: source || "sdk",
        time_spent: Math.floor((Date.now() - startTime) / 1e3)
      });
      if (heartbeatRef.current)
        clearInterval(heartbeatRef.current);
    } catch (e) {
      console.error("submitScore failed", e);
    }
  };
  const handleManualConfirm = async () => {
    if (!scoreResult)
      return;
    await submitScore(scoreResult.score, scoreResult.total);
  };
  const handleManualEntry = async (score, total) => {
    setScoreResult({ score, total });
    await submitScore(score, total, void 0, "manual_entry");
  };
  if (loading) {
    return /* @__PURE__ */ React5.createElement("div", { style: fullscreenCenter }, /* @__PURE__ */ React5.createElement("div", { style: { fontSize: 18, color: "#64748b", marginBottom: 8 } }, "\u{1F4D6}"), /* @__PURE__ */ React5.createElement("div", { style: { fontSize: 14, color: "#94a3b8" } }, "\u8BFE\u4EF6\u52A0\u8F7D\u4E2D..."));
  }
  if (errorMsg) {
    return /* @__PURE__ */ React5.createElement("div", { style: fullscreenCenter }, /* @__PURE__ */ React5.createElement("div", { style: { fontSize: 14, color: "#ef4444", marginBottom: 12 } }, errorMsg), /* @__PURE__ */ React5.createElement("button", { onClick: onBack, style: backBtnStyle }, "\u8FD4\u56DE\u8BFE\u4EF6\u5217\u8868"));
  }
  return /* @__PURE__ */ React5.createElement("div", { style: { position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "#fff", zIndex: 500 } }, /* @__PURE__ */ React5.createElement(
    "div",
    {
      onMouseEnter: () => setHeaderVisible(true),
      style: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        background: "rgba(255,255,255,0.95)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid #e5e7eb",
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        opacity: headerVisible ? 1 : 0,
        transition: "opacity 0.3s ease",
        pointerEvents: headerVisible ? "auto" : "none"
      }
    },
    /* @__PURE__ */ React5.createElement("button", { onClick: onBack, style: { ...backBtnStyle, fontSize: 13 } }, "\u2190 \u8FD4\u56DE\u5217\u8868"),
    /* @__PURE__ */ React5.createElement("span", { style: { fontSize: 13, fontWeight: 500, color: "#374151" } }, "\u8BFE\u4EF6\u5B66\u4E60"),
    /* @__PURE__ */ React5.createElement("span", { style: { fontSize: 11, color: "#94a3b8" } }, "\u5DF2\u7528 ", Math.floor((Date.now() - startTime) / 6e4), " \u5206\u949F")
  ), scoreResult && !submitted && /* @__PURE__ */ React5.createElement("div", { style: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    background: "#fef3c7",
    padding: "12px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between"
  } }, /* @__PURE__ */ React5.createElement("span", { style: { fontSize: 13, color: "#92400e" } }, "\u68C0\u6D4B\u5230\u6210\u7EE9\uFF1A", scoreResult.score, "/", scoreResult.total || "?"), /* @__PURE__ */ React5.createElement("button", { onClick: handleManualConfirm, style: { ...primaryBtnStyle2, padding: "4px 12px", fontSize: 12 } }, "\u786E\u8BA4\u63D0\u4EA4")), html && /* @__PURE__ */ React5.createElement(
    "iframe",
    {
      srcDoc: html,
      sandbox: "allow-scripts allow-same-origin",
      style: { width: "100%", height: "100%", border: "none", display: "block" },
      title: "\u8BFE\u4EF6\u5185\u5BB9",
      onMouseMove: resetHideTimer
    }
  ), submitted && scoreResult && /* @__PURE__ */ React5.createElement(
    ScoreOverlay,
    {
      score: scoreResult.score,
      total: scoreResult.total || scoreResult.score,
      timeSpent: Math.floor((Date.now() - startTime) / 1e3),
      onBack,
      onRetry: () => {
        setSubmitted(false);
        submittedRef.current = false;
        setScoreResult(null);
      }
    }
  ), scoreResult && scoreResult.total === 0 && scoreResult.score === 0 && !submitted && /* @__PURE__ */ React5.createElement(ManualEntryOverlay, { onConfirm: handleManualEntry, onBack }));
}
function ManualEntryOverlay({ onConfirm, onBack }) {
  const [score, setScore] = useState4("");
  const [total, setTotal] = useState4("100");
  return /* @__PURE__ */ React5.createElement("div", { style: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 } }, /* @__PURE__ */ React5.createElement("div", { style: { background: "#fff", borderRadius: 16, padding: "32px 40px", textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", maxWidth: 360 } }, /* @__PURE__ */ React5.createElement("div", { style: { fontSize: 40, marginBottom: 12 } }, "\u{1F4DD}"), /* @__PURE__ */ React5.createElement("h3", { style: { margin: "0 0 4px", fontSize: 18, color: "#1e293b" } }, "\u8BFE\u4EF6\u5DF2\u5B8C\u6210"), /* @__PURE__ */ React5.createElement("p", { style: { fontSize: 13, color: "#64748b", marginBottom: 20 } }, "\u8BFE\u4EF6\u672A\u81EA\u52A8\u63D0\u4EA4\u6210\u7EE9\uFF0C\u8BF7\u5728\u8BFE\u4EF6\u4E2D\u67E5\u770B\u5F97\u5206\u540E\u624B\u52A8\u586B\u5165\uFF1A"), /* @__PURE__ */ React5.createElement("div", { style: { display: "flex", gap: 12, alignItems: "center", justifyContent: "center", marginBottom: 20 } }, /* @__PURE__ */ React5.createElement("div", null, /* @__PURE__ */ React5.createElement("label", { style: { display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4 } }, "\u5F97\u5206"), /* @__PURE__ */ React5.createElement("input", { type: "number", value: score, onChange: (e) => setScore(e.target.value), style: { width: 100, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, textAlign: "center" }, placeholder: "0" })), /* @__PURE__ */ React5.createElement("span", { style: { fontSize: 18, color: "#94a3b8", marginTop: 16 } }, "/"), /* @__PURE__ */ React5.createElement("div", null, /* @__PURE__ */ React5.createElement("label", { style: { display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4 } }, "\u603B\u5206"), /* @__PURE__ */ React5.createElement("input", { type: "number", value: total, onChange: (e) => setTotal(e.target.value), style: { width: 100, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, textAlign: "center" }, placeholder: "100" }))), /* @__PURE__ */ React5.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "center" } }, /* @__PURE__ */ React5.createElement("button", { onClick: onBack, style: { ...primaryBtnStyle2, background: "#e5e7eb", color: "#374151" } }, "\u8FD4\u56DE\u5217\u8868"), /* @__PURE__ */ React5.createElement("button", { onClick: () => onConfirm(Number(score) || 0, Number(total) || 100), disabled: !score, style: { ...primaryBtnStyle2, opacity: !score ? 0.5 : 1 } }, "\u786E\u8BA4\u63D0\u4EA4"))));
}
var fullscreenCenter = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100vh",
  background: "#f8fafc"
};
var backBtnStyle = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "#3b82f6",
  padding: 0
};
var primaryBtnStyle2 = {
  padding: "6px 16px",
  border: "none",
  borderRadius: 6,
  background: "#3b82f6",
  color: "#fff",
  fontSize: 13,
  cursor: "pointer",
  fontWeight: 500
};

// src/frontend.tsx
var pluginCtx = null;
function TeacherPanelWrapper(props) {
  if (!pluginCtx)
    return null;
  const { renderType, mainNavCollapsed } = props || {};
  if (renderType === "button") {
    return React6.createElement(
      "button",
      {
        className: "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-gray-600 hover:bg-gray-100 hover:text-gray-900" + (mainNavCollapsed ? " justify-center" : ""),
        title: "\u8BFE\u4EF6\u7BA1\u7406"
      },
      React6.createElement("span", { className: "text-lg" }, "\u{1F4DA}"),
      !mainNavCollapsed && React6.createElement("span", { className: "text-sm font-medium" }, "\u8BFE\u4EF6\u7BA1\u7406")
    );
  }
  return React6.createElement(TeacherPanel, { ctx: pluginCtx });
}
function TeacherPanelDashboardWrapper(props) {
  console.log("[courseware-hub] TeacherPanelDashboardWrapper called, pluginCtx:", !!pluginCtx, "props:", props);
  if (!pluginCtx)
    return null;
  if (!props || !props.elementId)
    return null;
  const mergedCtx = { ...pluginCtx, elementId: props.elementId, lessonId: props.lessonId };
  return React6.createElement(TeacherPanel, { ctx: mergedCtx });
}
function StudentToolWrapper() {
  return pluginCtx ? React6.createElement(StudentTool, { ctx: pluginCtx }) : null;
}
function StudentFullscreenWrapper() {
  return pluginCtx ? React6.createElement(StudentFullscreen, { ctx: pluginCtx }) : null;
}
async function activate(hostCtx) {
  pluginCtx = hostCtx;
  if (hostCtx.ui?.registerExtensionPoint) {
    hostCtx.ui.registerExtensionPoint("teacher.tab", {
      id: "courseware-hub-teacher-tab",
      label: "\u8BFE\u4EF6\u7BA1\u7406",
      icon: "BookOpen",
      component: TeacherPanelWrapper,
      position: 70,
      pluginId: hostCtx.pluginId
    });
    hostCtx.ui.registerExtensionPoint("teacher.dashboard.widget", {
      id: "courseware-hub-teacher",
      label: "\u8BFE\u4EF6\u7BA1\u7406",
      icon: "BookOpen",
      component: TeacherPanelDashboardWrapper,
      pluginId: hostCtx.pluginId
    });
    hostCtx.ui.registerExtensionPoint("student.view", {
      id: "courseware-hub-student",
      component: StudentToolWrapper,
      pluginId: hostCtx.pluginId
    });
    hostCtx.ui.registerExtensionPoint("student.fullscreen", {
      id: "courseware-hub-student-fullscreen",
      component: StudentFullscreenWrapper,
      pluginId: hostCtx.pluginId
    });
  }
}
function deactivate() {
  pluginCtx = null;
}
var frontend_default = { activate, deactivate };
export {
  DashboardWidget,
  StudentFullscreen,
  StudentTool,
  TeacherPanel,
  frontend_default as default
};

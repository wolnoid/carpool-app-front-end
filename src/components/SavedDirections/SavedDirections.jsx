import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import styles from "./SavedDirections.module.css";

import { UserContext } from "../../contexts/UserContext";
import * as savedDirectionsService from "../../services/savedDirectionsService";
import { requestDirectionsSidebarExpand } from "../../utils/directionsSidebarState";
import { ROUTE_COMBO } from "../../routing/routeCombos";
import { getStartIconUrl, getEndIconUrl } from "../../maps/markerIconSvgs";

const MODE_OPTIONS = [
  { value: ROUTE_COMBO.TRANSIT, label: "transit" },
  { value: ROUTE_COMBO.TRANSIT_BIKE, label: "transit + bike" },
  { value: ROUTE_COMBO.BIKE, label: "bike" },
  { value: ROUTE_COMBO.TRANSIT_SKATE, label: "transit + skate" },
  { value: ROUTE_COMBO.SKATE, label: "skate" },
];

const MODE_LABEL_BY_VALUE = MODE_OPTIONS.reduce((acc, opt) => {
  acc[opt.value] = opt.label;
  return acc;
}, {});

function normalizeMode(mode) {
  const raw = String(mode || "").trim().toUpperCase();
  return MODE_LABEL_BY_VALUE[raw] ? raw : ROUTE_COMBO.TRANSIT;
}

function formatMode(mode) {
  const normalized = normalizeMode(mode);
  return MODE_LABEL_BY_VALUE[normalized] || "—";
}

function buildShareUrl(search) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const safe = typeof search === "string" ? search : "";
  return `${origin}/${safe.startsWith("?") ? safe : ""}`;
}

export default function SavedDirections({ embedded = false, showHeader = true }) {
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const startIconUrl = useMemo(() => getStartIconUrl(), []);
  const endIconUrl = useMemo(() => getEndIconUrl(), []);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editing, setEditing] = useState(null); // item
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editMode, setEditMode] = useState(ROUTE_COMBO.TRANSIT);
  const [editSaving, setEditSaving] = useState(false);

  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    if (user) return;
    if (embedded) return;
    navigate("/sign-in");
  }, [user, navigate, embedded]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await savedDirectionsService.index();
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.message || "Failed to load saved directions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    refresh();
  }, [user, refresh]);

  const countText = useMemo(() => {
    const n = items?.length ?? 0;
    return `${n} / 99`;
  }, [items]);

  async function handleDelete(id) {
    if (!id) return;
    const ok = window.confirm("Delete this saved direction?");
    if (!ok) return;

    try {
      await savedDirectionsService.remove(id);
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      window.alert(e?.message || "Failed to delete");
    }
  }

  async function handleCopyLink(item) {
    const url = buildShareUrl(item?.search);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(item?.id ?? null);
      window.setTimeout(() => setCopiedId(null), 1200);
    } catch {
      // fallback
      window.prompt("Copy link:", url);
    }
  }

  function handleOpen(item) {
    if (!item?.search) return;
    requestDirectionsSidebarExpand();
    // Keep the saved-id in the hash for update flow, but omit it from share links.
    navigate(`/${item.search}#sid=${item.id}`);
  }

  function beginEdit(item) {
    requestDirectionsSidebarExpand();
    setEditing(item);
    setEditName(item?.name ?? "");
    setEditDesc(item?.description ?? "");
    setEditMode(normalizeMode(item?.mode));
  }

  function cancelEdit() {
    setEditing(null);
    setEditName("");
    setEditDesc("");
    setEditMode(ROUTE_COMBO.TRANSIT);
    setEditSaving(false);
  }

  async function submitEdit() {
    if (!editing?.id) return;
    const nextName = String(editName || "").trim();
    if (!nextName) {
      window.alert("Route name is required");
      return;
    }
    setEditSaving(true);
    try {
      const mode = normalizeMode(editMode);
      const updated = await savedDirectionsService.update(editing.id, {
        name: nextName,
        description: editDesc,
        mode,
      });
      setItems((prev) =>
        prev.map((x) => (x.id === editing.id ? { ...x, ...(updated || {}), mode: updated?.mode ?? mode } : x))
      );
      cancelEdit();
    } catch (e) {
      window.alert(e?.message || "Failed to update");
      setEditSaving(false);
    }
  }

  if (!user) return null;

  return (
    <div className={`${styles.page} ${embedded ? styles.embedded : ""}`}>
      {showHeader && (
        <div className={styles.header}>
          <div className={styles.headerMain}>
            <h1 className={styles.title}>Saved directions</h1>
            <p className={styles.subtitle}>Bookmarks that rerun when opened.</p>
          </div>
          <div className={styles.counter} title="Saved directions limit">
            {countText}
          </div>
        </div>
      )}

      {loading ? (
        <div className={styles.stateCard}>Loading…</div>
      ) : error ? (
        <div className={styles.stateCard} role="alert">
          <div className={styles.stateTitle}>Couldn’t load saved directions</div>
          <div className={styles.stateText}>{error}</div>
          <button className={styles.btn} onClick={refresh} type="button">
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className={styles.stateCard}>
          <div className={styles.stateTitle}>No saved directions yet</div>
          <div className={styles.stateText}>
            Get directions on the map, then use the <strong>Save</strong> button.
          </div>
          <button className={styles.btn} onClick={() => navigate("/")} type="button">
            Go to map
          </button>
        </div>
      ) : (
        <div className={styles.list}>
          {items.map((it) => (
            <div key={it.id} className={styles.card}>
              <div className={styles.cardTop}>
                <div className={styles.topRow}>
                  <div className={styles.nameRow}>
                    <div className={styles.name}>{it.name || "(untitled)"}</div>
                  </div>
                  {editing?.id === it.id ? (
                    <select
                      className={styles.modeSelect}
                      value={editMode}
                      onChange={(e) => setEditMode(e.target.value)}
                      disabled={editSaving}
                      aria-label="Route mode"
                    >
                      {MODE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={styles.badge}>{formatMode(it.mode)}</span>
                  )}
                </div>
                {!!it.description && <div className={styles.desc}>{it.description}</div>}
                <div className={styles.routeLine}>
                  <div className={styles.odRow}>
                    <img className={`${styles.odIcon} ${styles.odIconStart}`} src={startIconUrl} alt="" aria-hidden="true" />
                    <span className={styles.odText} title={(it.origin_label || "Current location").trim()}>
                      {(it.origin_label || "Current location").trim()}
                    </span>
                  </div>
                  <div className={styles.odRow}>
                    <img className={`${styles.odIcon} ${styles.odIconEnd}`} src={endIconUrl} alt="" aria-hidden="true" />
                    <span className={styles.odText} title={(it.destination_label || "").trim() || "—"}>
                      {(it.destination_label || "").trim() || "—"}
                    </span>
                  </div>
                </div>
              </div>

              {editing?.id === it.id ? (
                <div className={styles.inlineEditor}>
                  <label className={styles.label}>
                    Name
                    <input
                      className={styles.input}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Required"
                      required
                    />
                  </label>

                  <label className={styles.label}>
                    Description
                    <textarea
                      className={styles.textarea}
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Optional"
                      rows={3}
                    />
                  </label>

                  <div className={styles.inlineEditorActions}>
                    <button
                      className={`${styles.btnPrimary} ${!editName.trim() ? styles.btnPrimaryInvalid : ""}`}
                      onClick={submitEdit}
                      type="button"
                      disabled={editSaving || !editName.trim()}
                    >
                      {editSaving ? "Saving…" : "Save"}
                    </button>
                    <button className={styles.btn} onClick={cancelEdit} type="button" disabled={editSaving}>
                      Cancel
                    </button>
                    <button className={styles.btnDanger} onClick={() => handleDelete(it.id)} type="button" disabled={editSaving}>
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.actions}>
                  <button className={styles.btnPrimary} onClick={() => handleOpen(it)} type="button">
                    View
                  </button>
                  <button className={styles.btn} onClick={() => handleCopyLink(it)} type="button">
                    {copiedId === it.id ? "Copied" : "Share"}
                  </button>
                  <button className={styles.btn} onClick={() => beginEdit(it)} type="button">
                    Edit
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

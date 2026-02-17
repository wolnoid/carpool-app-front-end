import { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import styles from "./SavedDirections.module.css";

import { UserContext } from "../../contexts/UserContext";
import * as savedDirectionsService from "../../services/savedDirectionsService";

function safeFmtDate(value) {
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
  } catch {
    return "";
  }
}

function buildShareUrl(search) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const safe = typeof search === "string" ? search : "";
  return `${origin}/${safe.startsWith("?") ? safe : ""}`;
}

export default function SavedDirections() {
  const { user } = useContext(UserContext);
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editing, setEditing] = useState(null); // item
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    if (user) return;
    navigate("/sign-in");
  }, [user, navigate]);

  async function refresh() {
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
  }

  useEffect(() => {
    if (!user) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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
    // Keep the saved-id in the hash for update flow, but omit it from share links.
    navigate(`/${item.search}#sid=${item.id}`);
  }

  function beginEdit(item) {
    setEditing(item);
    setEditName(item?.name ?? "");
    setEditDesc(item?.description ?? "");
  }

  function cancelEdit() {
    setEditing(null);
    setEditName("");
    setEditDesc("");
    setEditSaving(false);
  }

  async function submitEdit() {
    if (!editing?.id) return;
    setEditSaving(true);
    try {
      const updated = await savedDirectionsService.update(editing.id, {
        name: editName,
        description: editDesc,
      });
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      cancelEdit();
    } catch (e) {
      window.alert(e?.message || "Failed to update");
      setEditSaving(false);
    }
  }

  if (!user) return null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Saved directions</h1>
          <div className={styles.subtitle}>Bookmarks that rerun when opened.</div>
        </div>
        <div className={styles.counter} title="Saved directions limit">
          {countText}
        </div>
      </div>

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
                <div className={styles.nameRow}>
                  <div className={styles.name}>{it.name || "(untitled)"}</div>
                  <div className={styles.meta}>{safeFmtDate(it.updated_at || it.created_at)}</div>
                </div>
                {!!it.description && <div className={styles.desc}>{it.description}</div>}
                <div className={styles.routeLine}>
                  <span className={styles.badge}>{it.mode || "—"}</span>
                  <span className={styles.od}>
                    {(it.origin_label || "Current location").trim()} → {(it.destination_label || "").trim()}
                  </span>
                </div>
              </div>

              <div className={styles.actions}>
                <button className={styles.btnPrimary} onClick={() => handleOpen(it)} type="button">
                  Open
                </button>
                <button className={styles.btn} onClick={() => beginEdit(it)} type="button">
                  Edit
                </button>
                <button className={styles.btn} onClick={() => handleCopyLink(it)} type="button">
                  {copiedId === it.id ? "Copied" : "Share"}
                </button>
                <button className={styles.btnDanger} onClick={() => handleDelete(it.id)} type="button">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
          <div className={styles.modalCard}>
            <div className={styles.modalTitle}>Edit saved direction</div>

            <label className={styles.label}>
              Name
              <input
                className={styles.input}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Name"
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

            <div className={styles.modalActions}>
              <button className={styles.btn} onClick={cancelEdit} type="button" disabled={editSaving}>
                Cancel
              </button>
              <button
                className={styles.btnPrimary}
                onClick={submitEdit}
                type="button"
                disabled={editSaving}
              >
                {editSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef } from "react";
import styles from "./DirectionsSidebar.module.css";
import { getStartIconUrl, getEndIconUrl } from "../../maps/markerIconSvgs";
import { placeToLatLng } from "../../maps/directionsUtils";
import { usePlacePickerChange } from "../../hooks/usePlacePickerChange";
import { isTransitOn, isBikeOn, isSkateOn, nextCombo } from "../../routing/routeCombos";

export default function DirectionsSidebar({
  canRenderMap,
  userLoc,
  setOrigin,
  destination,
  setDestination,

  routeCombo,
  setRouteCombo,

  hillWeight,        // 0..1
  setHillWeight,

  onBuildRoute,
  onClearRoute,

  directionsPanelRef,

  originPickerRef,
  destPickerRef,

  routeOptions = [],
  selectedRouteIndex = 0,
  onSelectRoute,

  // Optional: if your “smart routing” returns a segment summary, show it here.
  selectedSegments = null,
  showGooglePanel = true,
}) {
  const internalOriginRef = useRef(null);
  const internalDestRef = useRef(null);

  const originRef = originPickerRef ?? internalOriginRef;
  const destRef = destPickerRef ?? internalDestRef;

  const startIconUrl = getStartIconUrl();
  const endIconUrl = getEndIconUrl();

  useEffect(() => {
    if (!canRenderMap || !userLoc) return;

    const attrs = {
      "location-bias": `${userLoc.lat},${userLoc.lng}`,
      radius: "20000",
    };

    [originRef.current, destRef.current].forEach((el) => {
      if (!el) return;
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    });
  }, [canRenderMap, userLoc, originRef, destRef]);

  const handleOriginPlaceChange = useCallback(
    (e, originEl) => {
      const place = e?.target?.value ?? originEl.value;
      const ll = placeToLatLng(place);
      if (ll) setOrigin(ll);
    },
    [setOrigin]
  );

  const handleDestPlaceChange = useCallback(
    (e, destEl) => {
      const place = e?.target?.value ?? destEl.value;
      const ll = placeToLatLng(place);
      if (ll) setDestination(ll);
    },
    [setDestination]
  );

  usePlacePickerChange(originRef, canRenderMap, handleOriginPlaceChange);
  usePlacePickerChange(destRef, canRenderMap, handleDestPlaceChange);

  const showRoutes = routeOptions?.length > 1 && typeof onSelectRoute === "function";

  const transitOn = isTransitOn(routeCombo);
  const bikeOn = isBikeOn(routeCombo);
  const skateOn = isSkateOn(routeCombo);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHeader}>Directions</div>

      <div className={styles.field}>
        <div className={styles.labelRow}>
          <img className={styles.markerIconStart} src={startIconUrl} alt="" aria-hidden="true" />
          <div className={styles.label}>From</div>
        </div>

        <gmpx-place-picker ref={originRef} for-map="map" placeholder="Start location" />

        <div className={styles.hint}>
          If you leave this blank, your current location is used (when available).
        </div>
      </div>

      <div className={styles.field}>
        <div className={styles.labelRow}>
          <img className={styles.markerIconEnd} src={endIconUrl} alt="" aria-hidden="true" />
          <div className={styles.label}>To</div>
        </div>

        <gmpx-place-picker ref={destRef} for-map="map" placeholder="Destination" />
      </div>

      <div className={styles.field}>
        <div className={styles.label}>Mode</div>
        <div className={styles.modeRow}>
          <button
            type="button"
            className={`${styles.modeBtn} ${transitOn ? styles.modeBtnOn : ""}`}
            onClick={() => setRouteCombo((c) => nextCombo(c, "TRANSIT"))}
          >
            Transit
          </button>
          <button
            type="button"
            className={`${styles.modeBtn} ${bikeOn ? styles.modeBtnOn : ""}`}
            onClick={() => setRouteCombo((c) => nextCombo(c, "BIKE"))}
          >
            Bike
          </button>
          <button
            type="button"
            className={`${styles.modeBtn} ${skateOn ? styles.modeBtnOn : ""}`}
            onClick={() => setRouteCombo((c) => nextCombo(c, "SKATE"))}
          >
            Skateboard
          </button>
        </div>
      </div>

      <div className={styles.field}>
        <div className={styles.labelRow}>
          <div className={styles.label}>Avoid hills</div>
          <div className={styles.hillValue}>{Math.round(hillWeight * 100)}</div>
        </div>
        <input
          className={styles.slider}
          type="range"
          min="0"
          max="100"
          value={Math.round(hillWeight * 100)}
          onChange={(e) => setHillWeight(Number(e.target.value) / 100)}
        />
        <div className={styles.hint}>0 = fastest, 100 = strongly prefers flatter cycling legs.</div>
      </div>

      {showRoutes && (
        <div className={styles.routes}>
          <div className={styles.routesTitle}>Routes</div>
          {routeOptions.map((r) => (
            <label key={r.index} className={styles.routeRow}>
              <input
                className={styles.routeRadio}
                type="radio"
                name="route"
                checked={selectedRouteIndex === r.index}
                onChange={() => onSelectRoute(r.index)}
              />
              <div className={styles.routeText}>
                <div className={styles.routeMain}>
                  {r.durationText ? r.durationText : "—"}{" "}
                  {r.distanceText ? `· ${r.distanceText}` : ""}
                </div>
                <div className={styles.routeSub}>{r.summary}</div>
              </div>
            </label>
          ))}
        </div>
      )}

      <div className={styles.actions}>
        <button className={styles.primaryBtn} onClick={onBuildRoute} disabled={!destination}>
          Get directions
        </button>
        <button className={styles.secondaryBtn} onClick={onClearRoute} type="button">
          Clear
        </button>
      </div>

      {selectedSegments && (
        <div className={styles.segments}>
          <div className={styles.routesTitle}>Itinerary</div>
          {selectedSegments.map((s, i) => (
            <div key={i} className={styles.segmentRow}>
              <strong>{s.mode}</strong> · {s.durationText}
            </div>
          ))}
        </div>
      )}

      {showGooglePanel && <div ref={directionsPanelRef} className={styles.panel} />}
    </aside>
  );
}

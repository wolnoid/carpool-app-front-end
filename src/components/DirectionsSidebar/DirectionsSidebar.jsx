import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { getStartIconUrl, getEndIconUrl } from "../../maps/markerIconSvgs";
import { placeToLatLng } from "../../maps/directionsUtils";
import { getPickerText, closePickerSuggestions } from "../../maps/placePicker";
import { usePlacePickerChange } from "../../hooks/usePlacePickerChange";

import { isTransitOn, isBikeOn, isSkateOn, nextCombo } from "../../routing/routeCombos";

import { SidebarView } from "./components/SidebarView";
import { useSidebarPickers } from "./hooks/useSidebarPickers";
import { buildRouteDetailsModel } from "./model/routeDetailsModel";
import { buildSidebarSegments } from "./utils/sidebarSegments";
import { carryHiddenMinuteMovesExceptEnds, useItinerarySegmentsFit } from "./utils/itineraryFit";

const LS_KEY = "carpool.sidebarCollapsed";

export default function DirectionsSidebar({
  canRenderMap,
  origin,
  userLoc,
  setOrigin,
  destination,
  setDestination,

  routeCombo,
  setRouteCombo,

  hillMaxDeg,
  setHillMaxDeg,

  // transit time props from Landing
  timeKind,
  setTimeKind,
  timeValue,
  setTimeValue,

  onBuildRoute,
  onClearRoute,

  directionsPanelRef,
  directionsDirty = true,

  originPickerRef,
  destPickerRef,

  routeOptions = [],
  isLoadingRoutes = false,
  routeError = null,
  selectedRouteIndex = 0,
  onSelectRoute,

  // Map viewport helpers
  onZoomToRoute,
  onZoomToAllRoutes,
}) {

  const {
    originRef,
    destRef,
    originLLRef,
    destLLRef,
    pickerSnapshotRef,
    snapshotPickers,
    restorePickers,
    handleSwap,
  } = useSidebarPickers({
    origin,
    userLoc,
    destination,
    setOrigin,
    setDestination,
    originPickerRef,
    destPickerRef,
  });

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage?.getItem(LS_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      window.localStorage?.setItem(LS_KEY, collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [collapsed]);

  const startIconUrl = getStartIconUrl();
  const endIconUrl = getEndIconUrl();

  // Bias autocomplete toward the user's location.
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

      if (ll) {
        originLLRef.current = ll;
        setOrigin(ll);
        closePickerSuggestions(originEl);
        return;
      }

      // If user cleared the field, fall back to user location (if available).
      const txt = (getPickerText(originEl) || "").trim();
      if (!txt) {
        const fallback = userLoc ?? null;
        originLLRef.current = fallback;
        if (fallback) setOrigin(fallback);
      }
    },
    [setOrigin, userLoc, originLLRef]
  );

  const handleDestPlaceChange = useCallback(
    (e, destEl) => {
      const place = e?.target?.value ?? destEl.value;
      const ll = placeToLatLng(place);

      if (ll) {
        destLLRef.current = ll;
        setDestination(ll);
        closePickerSuggestions(destEl);
        return;
      }

      // If the user cleared the destination field, clear destination state too.
      const txt = (getPickerText(destEl) || "").trim();
      if (!txt) {
        destLLRef.current = null;
        setDestination(null);
      }
    },
    [setDestination, destLLRef]
  );

  usePlacePickerChange(originRef, canRenderMap, handleOriginPlaceChange);
  usePlacePickerChange(destRef, canRenderMap, handleDestPlaceChange);

  const canShowRoutes = typeof onSelectRoute === "function";
  const showRoutes =
    canShowRoutes &&
    (((routeOptions?.length ?? 0) >= 1) || isLoadingRoutes || Boolean(routeError));

  const transitOn = isTransitOn(routeCombo);
  const bikeOn = isBikeOn(routeCombo);
  const skateOn = isSkateOn(routeCombo);


  const [detailsMode, setDetailsMode] = useState("NONE");

  const prevDetailsModeRef = useRef("NONE");
  useEffect(() => {
    const prev = prevDetailsModeRef.current;
    prevDetailsModeRef.current = detailsMode;

    // We keep the place pickers mounted (even in FULL details mode) and only hide them,
    // but still do a best-effort restore if either field is blank.
    if (detailsMode === "NONE" && prev !== "NONE") {
      const oEl = originRef.current;
      const dEl = destRef.current;

      const oText = oEl ? (getPickerText(oEl) || "").trim() : "";
      const dText = dEl ? (getPickerText(dEl) || "").trim() : "";

      const needsRestore = !oEl || !dEl || !oText || !dText;
      if (!needsRestore) return;

      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => restorePickers());
      } else {
        setTimeout(() => restorePickers(), 0);
      }
    }
  }, [detailsMode, restorePickers, originRef, destRef]);

  const resultsScrollRef = useRef(null);
  const inlineDetailsRef = useRef(null);

  useEffect(() => {
    if ((routeOptions?.length ?? 0) === 0) setDetailsMode("NONE");
  }, [routeOptions]);

  // Ensure loading state is always visible in the routes list (not hidden behind details mode).
  useEffect(() => {
    if (isLoadingRoutes) setDetailsMode("NONE");
  }, [isLoadingRoutes]);

  const selectedOption = useMemo(() => {
    if (!routeOptions || routeOptions.length === 0) return null;
    return routeOptions.find((o) => o.index === selectedRouteIndex) || routeOptions[0] || null;
  }, [routeOptions, selectedRouteIndex]);

  const detailsRouteModel = useMemo(() => buildRouteDetailsModel(selectedOption), [selectedOption]);

  const detailsRouteModelDisplay = useMemo(() => {
    if (!detailsRouteModel) return null;
    const segs = carryHiddenMinuteMovesExceptEnds(detailsRouteModel.segments ?? []);
    return { ...detailsRouteModel, segments: segs };
  }, [detailsRouteModel]);

  const detailsItinBaseSegs = useMemo(() => {
    if (!selectedOption) return [];
    return carryHiddenMinuteMovesExceptEnds(buildSidebarSegments(selectedOption, routeCombo));
  }, [selectedOption, routeCombo]);

  const { barRef: detailsItinRef, segs: detailsItinSegs } = useItinerarySegmentsFit(detailsItinBaseSegs);

  useLayoutEffect(() => {
    if (detailsMode !== "INLINE") return;

    const container = resultsScrollRef.current;
    const content = inlineDetailsRef.current;
    if (!container || !content) return;

    const check = () => {
      const fits = content.scrollHeight <= container.clientHeight + 2;
      if (!fits) {
        snapshotPickers();
        setDetailsMode("FULL");
      }
    };

    if (typeof requestAnimationFrame === "function") requestAnimationFrame(check);
    else check();

    const ro = new ResizeObserver(() => check());
    ro.observe(container);
    ro.observe(content);
    return () => ro.disconnect();
  }, [detailsMode, selectedRouteIndex, selectedOption, detailsRouteModelDisplay, snapshotPickers]);

  // While already viewing route details, selecting a different route on the map should
  // zoom/focus to that newly-selected route. Outside of details view, map clicks should
  // NOT change the current viewport.
  const prevDetailsModeForZoomRef = useRef(detailsMode);
  const prevSelectedIdxForZoomRef = useRef(selectedRouteIndex);
  useEffect(() => {
    const prevMode = prevDetailsModeForZoomRef.current;
    const prevIdx = prevSelectedIdxForZoomRef.current;

    // Update refs first for the next run.
    prevDetailsModeForZoomRef.current = detailsMode;
    prevSelectedIdxForZoomRef.current = selectedRouteIndex;

    const wasInDetails = prevMode !== "NONE";
    const isInDetails = detailsMode !== "NONE";
    if (!wasInDetails || !isInDetails) return;
    if (prevIdx === selectedRouteIndex) return;

    if (typeof onZoomToRoute === "function") onZoomToRoute(selectedRouteIndex);
  }, [detailsMode, selectedRouteIndex, onZoomToRoute]);


  // Keep our snapshot reasonably fresh during normal usage.
  useEffect(() => {
    if (detailsMode !== "NONE") return;
    snapshotPickers();
  }, [detailsMode, destination, userLoc, snapshotPickers]);

  // Keep the visible datetime box set to “now” when Leave now is selected.
  useEffect(() => {
    if (timeKind === "NOW") {
      setTimeValue(new Date());
    }
  }, [timeKind, setTimeValue]);


  return (
    <SidebarView
      collapsed={collapsed}
      setCollapsed={setCollapsed}
      detailsMode={detailsMode}
      setDetailsMode={setDetailsMode}
      showRoutes={showRoutes}
      transitOn={transitOn}
      bikeOn={bikeOn}
      skateOn={skateOn}
      setRouteCombo={setRouteCombo}
      nextCombo={nextCombo}
      routeCombo={routeCombo}
      startIconUrl={startIconUrl}
      endIconUrl={endIconUrl}
      originRef={originRef}
      destRef={destRef}
      handleSwap={handleSwap}
      destination={destination}
      timeKind={timeKind}
      setTimeKind={setTimeKind}
      timeValue={timeValue}
      setTimeValue={setTimeValue}
      onBuildRoute={onBuildRoute}
      onClearRoute={onClearRoute}
      directionsDirty={directionsDirty}
      hillMaxDeg={hillMaxDeg}
      setHillMaxDeg={setHillMaxDeg}
      canRenderMap={canRenderMap}
      directionsPanelRef={directionsPanelRef}
      resultsScrollRef={resultsScrollRef}
      inlineDetailsRef={inlineDetailsRef}
      isLoadingRoutes={isLoadingRoutes}
      routeError={routeError}
      routeOptions={routeOptions}
      selectedRouteIndex={selectedRouteIndex}
      onSelectRoute={onSelectRoute}
      onZoomToAllRoutes={onZoomToAllRoutes}
      onZoomToRoute={onZoomToRoute}
      detailsRouteModelDisplay={detailsRouteModelDisplay}
      selectedOption={selectedOption}
      detailsItinRef={detailsItinRef}
      detailsItinSegs={detailsItinSegs}
      pickerSnapshotRef={pickerSnapshotRef}
    />
  );
}

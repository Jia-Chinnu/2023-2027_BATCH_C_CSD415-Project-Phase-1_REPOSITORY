import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* =========================================================
   TRUSTCHARGE PORT RESERVATION
   ---------------------------------------------------------
   Ticket-booking style flow:
     1. Choose a station (most reliable first)
     2. Choose start time + duration
     3. Pick a bay from the port map (like choosing a seat)
     4. Confirm - the reservation fee is billed from the wallet
        using the member discount of your plan.

   Honesty notes (shown in the UI as well):
   - NDW publishes free / total counts per connector group, not a
     stable ID per physical socket. Bays are therefore numbered
     slots of a connector group ("Bay 1.2"). Reservations are
     unique per bay slot inside TrustCharge.
   - Live "in use" state only applies to bookings starting soon;
     for later times only existing reservations block a bay.
========================================================= */

const DURATIONS = [30, 60, 90, 120];

const START_OPTIONS = [
  { id: "NOW", label: "Now", offset: 0 },
  { id: "30", label: "In 30 min", offset: 30 },
  { id: "60", label: "In 1 hour", offset: 60 },
  { id: "180", label: "In 3 hours", offset: 180 },
  { id: "CUSTOM", label: "Pick date & time", offset: null },
];

const PLAN_NAMES = { STANDARD: "Standard", PLUS: "Plus", PRO: "Pro Priority Pass" };

const PORT_STYLE = {
  AVAILABLE: { bg: "#ECFDF5", border: "#10B981", fg: "#047857", tag: "FREE NOW" },
  BOOKABLE: { bg: "#F0FDF4", border: "#86EFAC", fg: "#166534", tag: "OPEN" },
  RESERVED: { bg: "#F1F5F9", border: "#CBD5E1", fg: "#94A3B8", tag: "BOOKED" },
  OCCUPIED: { bg: "#FFFBEB", border: "#FCD34D", fg: "#B45309", tag: "IN USE" },
  OUT_OF_SERVICE: { bg: "#FEF2F2", border: "#FCA5A5", fg: "#B91C1C", tag: "FAULT" },
};

const RES_STATUS = {
  UPCOMING: { bg: "#EFF6FF", fg: "#1D4ED8", label: "UPCOMING" },
  ACTIVE_NOW: { bg: "#ECFDF5", fg: "#047857", label: "ACTIVE NOW" },
  COMPLETED: { bg: "#F1F5F9", fg: "#64748B", label: "COMPLETED" },
  CANCELLED: { bg: "#FEF2F2", fg: "#B91C1C", label: "CANCELLED" },
};

/* ---------- helpers ---------- */

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const eur = (v) => `€${Number(v || 0).toFixed(2)}`;

function starsFor(station) {
  const r = num(station?.reliability);
  if (r === null) return null;
  return Math.min(5, Math.max(0, Math.round((r / 100) * 5 * 2) / 2));
}

function Stars({ station, size = 12 }) {
  const stars = starsFor(station);

  if (stars === null) {
    return (
      <span style={{ fontSize: Math.max(9, size - 2), color: "#94A3B8", fontWeight: 800 }}>
        {station?.reliabilityLabel || "Collecting live data"}
      </span>
    );
  }

  const full = Math.floor(stars);
  const half = stars - full === 0.5;
  const empty = Math.max(0, 5 - full - (half ? 1 : 0));

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span
        aria-label={`${stars.toFixed(1)} out of 5`}
        style={{ fontSize: size, color: "#F59E0B", letterSpacing: 1, lineHeight: 1 }}
      >
        {"★".repeat(full)}
        {half ? "✬" : ""}
        {"☆".repeat(empty)}
      </span>
      <span style={{ fontSize: Math.max(9, size - 3), color: "#64748B", fontWeight: 800 }}>
        {stars.toFixed(1)}
        {num(station?.observationCount) !== null ? ` (${station.observationCount} obs.)` : ""}
      </span>
    </span>
  );
}

function fmtWhen(iso) {
  try {
    return new Date(iso).toLocaleString([], {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function fmtClock(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/* =========================================================
   MAIN COMPONENT
========================================================= */

export default function Reservation({
  user,
  apiBaseUrl,
  stations = [],
  currentCoords,
  wallet,
  initialStationId,
  onNavigate,
  onWalletRefresh,
  onReservationsChanged,
}) {
  const uid = user?.uid;

  const [tab, setTab] = useState("book");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState("RELIABILITY");
  const [onlyFree, setOnlyFree] = useState(false);

  const [pickedStation, setPickedStation] = useState(null);
  const [startMode, setStartMode] = useState("NOW");
  const [customStart, setCustomStart] = useState(() =>
    toLocalInputValue(new Date(Date.now() + 2 * 3600 * 1000))
  );
  const [duration, setDuration] = useState(60);

  const [layout, setLayout] = useState(null);
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [layoutError, setLayoutError] = useState("");
  const [selectedPortKey, setSelectedPortKey] = useState(null);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ type: "", text: "" });
  const [confirmed, setConfirmed] = useState(null);

  const [mine, setMine] = useState(null);
  const [mineLoading, setMineLoading] = useState(false);

  const layoutAbortRef = useRef(null);

  /* ---------- station list ---------- */

  const station = useMemo(() => {
    if (!pickedStation) return null;
    const fresh = stations.find((s) => String(s.id) === String(pickedStation.id));
    return fresh || pickedStation;
  }, [stations, pickedStation]);

  const rankedStations = useMemo(() => {
    const q = search.trim().toLowerCase();

    let list = stations.filter(
      (s) => s && s.id && (num(s.totalPorts) ?? 0) > 0 && s.status !== "OUT_OF_SERVICE"
    );

    if (q) {
      const has = (v) => String(v || "").toLowerCase().includes(q);
      list = list.filter((s) => has(s.name) || has(s.operator) || has(s.address));
    }

    if (onlyFree) list = list.filter((s) => (num(s.availablePorts) ?? 0) > 0);

    list = [...list].sort((a, b) => {
      if (sortMode === "DISTANCE") {
        return (num(a.distanceKm) ?? 9999) - (num(b.distanceKm) ?? 9999);
      }

      const ra = num(a.reliability);
      const rb = num(b.reliability);

      if (ra !== null && rb !== null && ra !== rb) return rb - ra;
      if (ra !== null && rb === null) return -1;
      if (ra === null && rb !== null) return 1;

      const fa = num(a.availablePorts) ?? 0;
      const fb = num(b.availablePorts) ?? 0;
      if (fa !== fb) return fb - fa;

      return (num(a.distanceKm) ?? 9999) - (num(b.distanceKm) ?? 9999);
    });

    return list.slice(0, 40);
  }, [stations, search, sortMode, onlyFree]);

  // Preselect: the station chosen on the dashboard, else the most reliable one.
  useEffect(() => {
    if (pickedStation) return;

    const wanted = initialStationId
      ? stations.find((s) => String(s.id) === String(initialStationId))
      : null;

    if (wanted) setPickedStation(wanted);
    else if (rankedStations[0]) setPickedStation(rankedStations[0]);
  }, [pickedStation, initialStationId, stations, rankedStations]);

  const chooseStation = (s) => {
    setPickedStation(s);
    setSelectedPortKey(null);
    setConfirmed(null);
    setNotice({ type: "", text: "" });
  };

  /* ---------- start time ---------- */

  const computeStartIso = useCallback(() => {
    if (startMode === "CUSTOM") {
      const d = new Date(customStart);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }

    const opt = START_OPTIONS.find((o) => o.id === startMode) || START_OPTIONS[0];
    return new Date(Date.now() + (opt.offset || 0) * 60000).toISOString();
  }, [startMode, customStart]);

  /* ---------- port layout ---------- */

  const stationId = station?.id;
  const stationLat = station?.latitude;
  const stationLon = station?.longitude;

  const loadLayout = useCallback(async () => {
    if (!stationId || !uid) return;

    const startIso = computeStartIso();

    if (!startIso) {
      setLayoutError("Choose a valid start time.");
      return;
    }

    if (layoutAbortRef.current) layoutAbortRef.current.abort();

    const controller = new AbortController();
    layoutAbortRef.current = controller;

    setLayoutLoading(true);
    setLayoutError("");

    try {
      const params = new URLSearchParams({
        lat: String(stationLat),
        lng: String(stationLon),
        start: startIso,
        duration: String(duration),
        firebaseUid: uid,
      });

      const response = await fetch(
        `${apiBaseUrl}/api/reservations/ports/${encodeURIComponent(stationId)}?${params.toString()}`,
        { signal: controller.signal, cache: "no-store" }
      );

      const data = await response.json();

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Could not load the port map.");
      }

      setLayout(data);

      setSelectedPortKey((prev) => {
        if (!prev) return null;
        const stillOk = data.groups?.some((g) =>
          g.ports.some((p) => p.key === prev && p.selectable)
        );
        return stillOk ? prev : null;
      });
    } catch (error) {
      if (error?.name === "AbortError") return;
      setLayout(null);
      setLayoutError(error?.message || "Could not load the port map.");
    } finally {
      if (layoutAbortRef.current === controller) {
        layoutAbortRef.current = null;
        setLayoutLoading(false);
      }
    }
  }, [apiBaseUrl, stationId, stationLat, stationLon, uid, duration, computeStartIso]);

  useEffect(() => {
    loadLayout();
    return () => {
      if (layoutAbortRef.current) layoutAbortRef.current.abort();
    };
  }, [loadLayout]);

  useEffect(() => {
    const timer = setInterval(loadLayout, 30000);
    return () => clearInterval(timer);
  }, [loadLayout]);

  /* ---------- my reservations ---------- */

  const loadMine = useCallback(async () => {
    if (!uid) return;

    setMineLoading(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/reservations/user/${uid}`, {
        cache: "no-store",
      });
      const data = await response.json();

      if (response.ok && data?.success) {
        setMine(data);
        if (onReservationsChanged) onReservationsChanged();
      }
    } catch (error) {
      console.error("Reservation list failed:", error);
    } finally {
      setMineLoading(false);
    }
  }, [apiBaseUrl, uid, onReservationsChanged]);

  useEffect(() => {
    loadMine();
  }, [loadMine]);

  /* ---------- derived ---------- */

  const membership = layout?.membership || mine?.membership || null;
  const benefits = membership?.benefits || null;
  const planTier = membership?.tier || "STANDARD";

  const allPorts = useMemo(
    () =>
      (layout?.groups || []).flatMap((g) => g.ports.map((p) => ({ ...p, group: g }))),
    [layout]
  );

  const selectedPort = allPorts.find((p) => p.key === selectedPortKey) || null;
  const bestPort = allPorts.find((p) => p.key === layout?.recommendedPortKey) || null;

  const fee = layout?.fee || null;
  const walletBalance = Number(wallet?.balance || 0);
  const notEnoughWallet = Boolean(fee && fee.total > 0 && walletBalance + 0.004 < fee.total);

  const energyDiscount = benefits?.energyDiscountPct || 0;
  const listPrice = num(selectedPort?.group?.pricePerKwh);
  const memberPrice = listPrice !== null ? listPrice * (1 - energyDiscount / 100) : null;

  const durationOptions = DURATIONS.filter((d) => !benefits || d <= benefits.maxDurationMin);

  useEffect(() => {
    if (benefits && duration > benefits.maxDurationMin) setDuration(benefits.maxDurationMin);
  }, [benefits, duration]);

  /* ---------- actions ---------- */

  const autoPick = () => {
    if (layout?.recommendedPortKey) setSelectedPortKey(layout.recommendedPortKey);
  };

  const confirmBooking = async () => {
    if (!selectedPort || !station || busy) return;

    const startIso = computeStartIso();
    if (!startIso) return;

    setBusy(true);
    setNotice({ type: "", text: "" });

    try {
      const response = await fetch(`${apiBaseUrl}/api/reservations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firebaseUid: uid,
          stationId: station.id,
          latitude: station.latitude,
          longitude: station.longitude,
          portKey: selectedPort.key,
          startAt: startIso,
          durationMin: duration,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Could not create the reservation.");
      }

      setConfirmed(data.reservation);
      setSelectedPortKey(null);

      if (onWalletRefresh) onWalletRefresh();
      loadLayout();
      loadMine();
    } catch (error) {
      setNotice({ type: "error", text: error?.message || "Could not create the reservation." });
      loadLayout();
    } finally {
      setBusy(false);
    }
  };

  const cancelReservation = async (reservation) => {
    const refundText =
      reservation.refundIfCancelled > 0
        ? `You will be refunded ${eur(reservation.refundIfCancelled)}.`
        : reservation.feeCharged > 0
        ? "It is too close to the start time for a refund."
        : "No fee was charged.";

    if (!window.confirm(`Cancel reservation ${reservation.code}? ${refundText}`)) return;

    try {
      const response = await fetch(`${apiBaseUrl}/api/reservations/${reservation.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firebaseUid: uid }),
      });

      const data = await response.json();

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Could not cancel the reservation.");
      }

      setNotice({
        type: "ok",
        text:
          data.refunded > 0
            ? `Reservation cancelled. ${eur(data.refunded)} returned to your wallet.`
            : "Reservation cancelled.",
      });

      if (onWalletRefresh) onWalletRefresh();
      loadMine();
      loadLayout();
    } catch (error) {
      setNotice({ type: "error", text: error?.message || "Could not cancel the reservation." });
    }
  };

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <div>
      <style>
        {`
          .rv-grid { display:grid; grid-template-columns:minmax(260px,.85fr) minmax(0,2fr); gap:14px; align-items:start; }
          .rv-bookgrid { display:grid; grid-template-columns:minmax(0,1.6fr) minmax(250px,1fr); gap:14px; align-items:start; }
          .rv-port { transition:transform .12s ease, box-shadow .12s ease; }
          .rv-port:not(:disabled):hover { transform:translateY(-2px); }
          .rv-row:hover { border-color:#F59E0B !important; }
          @media(max-width:1100px){ .rv-bookgrid { grid-template-columns:1fr; } }
          @media(max-width:860px){ .rv-grid { grid-template-columns:1fr; } }
        `}
      </style>

      <div style={rs.pageHeader}>
        <div>
          <div style={rs.eyebrow}>PORT RESERVATION</div>
          <div style={rs.pageTitle}>Reserve a charging bay</div>
        </div>

        <div style={rs.tabs}>
          {[
            ["book", "Book a port"],
            ["mine", `My reservations${mine?.upcomingCount ? ` (${mine.upcomingCount})` : ""}`],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              style={{ ...rs.tab, ...(tab === id ? rs.tabActive : {}) }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* MEMBERSHIP STRIP */}

      <div style={rs.planStrip}>
        <div>
          <span style={rs.planBadge}>{PLAN_NAMES[planTier] || planTier}</span>
          {benefits ? (
            <span style={rs.planText}>
              {benefits.reservationFeeDiscountPct >= 100
                ? "Reservations are free"
                : benefits.reservationFeeDiscountPct > 0
                ? `${benefits.reservationFeeDiscountPct}% off reservation fees`
                : "Standard reservation fees"}
              {" • "}
              {benefits.energyDiscountPct > 0
                ? `${benefits.energyDiscountPct}% off energy`
                : "no energy discount"}
              {" • "}
              book up to {benefits.maxAdvanceHours >= 48 ? `${Math.round(benefits.maxAdvanceHours / 24)} days` : `${benefits.maxAdvanceHours} h`} ahead
              {" • "}
              {benefits.maxActiveReservations} active at once
            </span>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={rs.walletChip}>Wallet {eur(walletBalance)}</span>
          {planTier !== "PRO" && onNavigate && (
            <button type="button" style={rs.upgradeButton} onClick={() => onNavigate("payment")}>
              ⭐ Upgrade for more perks
            </button>
          )}
        </div>
      </div>

      {notice.text && (
        <div style={notice.type === "error" ? rs.noticeError : rs.noticeOk}>
          <span>{notice.text}</span>
          {notice.type === "error" && /wallet|top/i.test(notice.text) && onNavigate ? (
            <button type="button" style={rs.noticeLink} onClick={() => onNavigate("dashboard")}>
              Top up wallet
            </button>
          ) : null}
        </div>
      )}

      {tab === "mine" ? (
        <MyReservations
          data={mine}
          loading={mineLoading}
          onCancel={cancelReservation}
          onBook={() => setTab("book")}
        />
      ) : (
        <div className="rv-grid">
          {/* ---------- STATION PICKER ---------- */}
          <section style={rs.card}>
            <div style={rs.eyebrow}>STEP 1</div>
            <div style={rs.cardTitle}>Choose a station</div>

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search station, operator, address..."
              style={rs.input}
            />

            <div style={rs.chipRow}>
              {[
                ["RELIABILITY", "Most reliable"],
                ["DISTANCE", "Nearest"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSortMode(id)}
                  style={{ ...rs.chip, ...(sortMode === id ? rs.chipActive : {}) }}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setOnlyFree((v) => !v)}
                style={{ ...rs.chip, ...(onlyFree ? rs.chipActive : {}) }}
              >
                Free ports now
              </button>
            </div>

            <div style={rs.stationList}>
              {rankedStations.length === 0 ? (
                <div style={rs.empty}>
                  No stations with port data match. Try another region on the dashboard.
                </div>
              ) : (
                rankedStations.map((s, index) => {
                  const selected = station && String(station.id) === String(s.id);

                  return (
                    <button
                      key={s.id}
                      type="button"
                      className="rv-row"
                      onClick={() => chooseStation(s)}
                      style={{ ...rs.stationRow, ...(selected ? rs.stationRowActive : {}) }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={rs.stationName}>
                          {sortMode === "RELIABILITY" && index === 0 && num(s.reliability) !== null ? (
                            <span style={rs.topBadge}>TOP PICK</span>
                          ) : null}
                          {s.name}
                        </div>
                        <div style={rs.stationSub}>{s.address || "Address unavailable"}</div>
                        <div style={{ marginTop: 4 }}>
                          <Stars station={s} size={11} />
                        </div>
                      </div>

                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={rs.stationPorts}>
                          {num(s.availablePorts) !== null ? `${s.availablePorts}/${s.totalPorts}` : "—"} free
                        </div>
                        <div style={rs.stationSub}>
                          {num(s.distanceKm) !== null ? `${Number(s.distanceKm).toFixed(1)} km` : ""}
                          {num(s.powerKw) !== null ? ` • ${s.powerKw} kW` : ""}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* ---------- BOOKING ---------- */}
          <div>
            {!station ? (
              <section style={rs.card}>
                <div style={rs.empty}>Select a station to see its ports.</div>
              </section>
            ) : (
              <>
                {/* Station header */}
                <section style={rs.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={rs.cardTitle}>{station.name}</div>
                      <div style={rs.stationSub}>
                        {station.operator || "Unknown operator"} • {station.address || "Address unavailable"}
                      </div>
                    </div>
                    <Stars station={station} size={14} />
                  </div>

                  <div style={rs.factGrid}>
                    <Fact label="LIVE PORTS" value={
                      num(station.availablePorts) !== null
                        ? `${station.availablePorts} / ${station.totalPorts} free`
                        : "Unavailable"
                    } />
                    <Fact label="MAX POWER" value={num(station.powerKw) !== null ? `${station.powerKw} kW` : "Unavailable"} />
                    <Fact label="TARIFF" value={
                      num(station.pricePerKwh) !== null ? `€${Number(station.pricePerKwh).toFixed(3)} / kWh` : "Not published"
                    } />
                    <Fact label="DISTANCE" value={
                      num(station.distanceKm) !== null ? `${Number(station.distanceKm).toFixed(1)} km` : "—"
                    } />
                    <Fact label="FAULTY PORTS" value={String(num(station.faultyPorts) ?? "—")} />
                    <Fact label="CUSTOMER RATING" value={
                      num(station.customerRating) !== null
                        ? `${station.customerRating} ★ (${station.customerRatingCount})`
                        : "No ratings yet"
                    } />
                  </div>
                </section>

                {/* Time + duration */}
                <section style={rs.card}>
                  <div style={rs.eyebrow}>STEP 2</div>
                  <div style={rs.cardTitle}>When do you arrive?</div>

                  <div style={rs.chipRow}>
                    {START_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setStartMode(opt.id)}
                        style={{ ...rs.chip, ...(startMode === opt.id ? rs.chipActive : {}) }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {startMode === "CUSTOM" && (
                    <input
                      type="datetime-local"
                      value={customStart}
                      min={toLocalInputValue(new Date())}
                      onChange={(e) => setCustomStart(e.target.value)}
                      style={{ ...rs.input, marginTop: 10, maxWidth: 260 }}
                    />
                  )}

                  <div style={{ ...rs.eyebrow, marginTop: 14 }}>DURATION</div>
                  <div style={rs.chipRow}>
                    {durationOptions.map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDuration(d)}
                        style={{ ...rs.chip, ...(duration === d ? rs.chipActive : {}) }}
                      >
                        {d} min
                      </button>
                    ))}
                  </div>

                  {layout?.window && (
                    <div style={rs.windowText}>
                      Your slot: <strong>{fmtWhen(layout.window.startAt)}</strong> → {fmtClock(layout.window.endAt)}
                    </div>
                  )}
                </section>

                <div className="rv-bookgrid">
                  {/* Port map */}
                  <section style={rs.card}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <div>
                        <div style={rs.eyebrow}>STEP 3</div>
                        <div style={rs.cardTitle}>Pick your bay</div>
                      </div>

                      <button
                        type="button"
                        style={rs.autoButton}
                        onClick={autoPick}
                        disabled={!layout?.recommendedPortKey}
                      >
                        ✨ Auto-pick best bay
                      </button>
                    </div>

                    {layoutError && <div style={rs.errorBox}>⚠ {layoutError}</div>}

                    {layoutLoading && !layout && <div style={rs.empty}>Loading live port map…</div>}

                    {layout && layout.groups.length === 0 && (
                      <div style={rs.empty}>
                        This station does not publish per-port data, so it cannot be reserved. Choose another
                        station.
                      </div>
                    )}

                    {layout?.groups.map((group) => (
                      <div key={group.groupKey} style={rs.groupBox}>
                        <div style={rs.groupHead}>
                          <div>
                            <div style={rs.groupTitle}>{String(group.connectorType).replace(/_/g, " ")}</div>
                            <div style={rs.stationSub}>
                              {num(group.powerKw) !== null ? `${group.powerKw} kW` : "Power unavailable"}
                              {" • "}
                              {num(group.pricePerKwh) !== null
                                ? `€${Number(group.pricePerKwh).toFixed(3)} / kWh`
                                : "Tariff not published"}
                            </div>
                          </div>
                          <div style={rs.stationSub}>
                            {group.ports.filter((p) => p.selectable).length} of {group.totalPorts} bookable
                          </div>
                        </div>

                        <div style={rs.portGrid}>
                          {group.ports.map((port) => {
                            const st = PORT_STYLE[port.state] || PORT_STYLE.RESERVED;
                            const isSel = port.key === selectedPortKey;
                            const isBest = port.key === layout.recommendedPortKey;

                            return (
                              <button
                                key={port.key}
                                type="button"
                                className="rv-port"
                                disabled={!port.selectable}
                                onClick={() => setSelectedPortKey(port.key)}
                                aria-pressed={isSel}
                                aria-label={`${port.label}, ${st.tag}`}
                                style={{
                                  ...rs.port,
                                  background: isSel ? "#111827" : st.bg,
                                  borderColor: isSel ? "#F59E0B" : st.border,
                                  color: isSel ? "#FFFFFF" : st.fg,
                                  cursor: port.selectable ? "pointer" : "not-allowed",
                                  boxShadow: isSel ? "0 0 0 3px rgba(245,158,11,.35)" : "none",
                                  backgroundImage: port.state === "RESERVED"
                                    ? "repeating-linear-gradient(45deg,transparent 0 6px,rgba(148,163,184,.25) 6px 8px)"
                                    : "none",
                                }}
                              >
                                {isBest && <span style={rs.bestTag}>BEST</span>}
                                <span style={{ fontSize: 17 }}>⚡</span>
                                <span style={rs.portLabel}>{port.label.replace("Bay ", "")}</span>
                                <span style={rs.portTag}>{isSel ? "YOURS" : st.tag}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}

                    <div style={rs.legend}>
                      {["AVAILABLE", "BOOKABLE", "OCCUPIED", "RESERVED", "OUT_OF_SERVICE"].map((k) => (
                        <span key={k} style={rs.legendItem}>
                          <span style={{ ...rs.legendDot, background: PORT_STYLE[k].bg, borderColor: PORT_STYLE[k].border }} />
                          {PORT_STYLE[k].tag}
                        </span>
                      ))}
                      <span style={rs.legendItem}>
                        <span style={{ ...rs.legendDot, background: "#111827", borderColor: "#F59E0B" }} />
                        YOUR PICK
                      </span>
                    </div>

                    {layout?.note && <div style={rs.footNote}>{layout.note}</div>}
                  </section>

                  {/* Ticket */}
                  <section style={rs.ticket}>
                    {confirmed ? (
                      <ConfirmedTicket
                        reservation={confirmed}
                        onDone={() => setConfirmed(null)}
                        onMine={() => {
                          setConfirmed(null);
                          setTab("mine");
                        }}
                      />
                    ) : (
                      <>
                        <div style={rs.ticketTop}>
                          <div style={rs.ticketEyebrow}>RESERVATION TICKET</div>
                          <div style={rs.ticketStation}>{station.name}</div>
                        </div>

                        <div style={rs.ticketPerf} />

                        <div style={rs.ticketBody}>
                          <TicketRow label="Bay" value={selectedPort ? selectedPort.label : "Select a bay"} strong />
                          <TicketRow
                            label="Connector"
                            value={selectedPort ? String(selectedPort.group.connectorType).replace(/_/g, " ") : "—"}
                          />
                          <TicketRow
                            label="Power"
                            value={selectedPort && num(selectedPort.group.powerKw) !== null ? `${selectedPort.group.powerKw} kW` : "—"}
                          />
                          <TicketRow
                            label="Arrive"
                            value={layout?.window ? fmtWhen(layout.window.startAt) : "—"}
                          />
                          <TicketRow label="Hold until" value={layout?.window ? fmtClock(layout.window.endAt) : "—"} />

                          <TicketRow
                            label="Energy price"
                            value={
                              listPrice === null
                                ? "Not published"
                                : energyDiscount > 0
                                ? `€${memberPrice.toFixed(3)} /kWh (was €${listPrice.toFixed(3)})`
                                : `€${listPrice.toFixed(3)} /kWh`
                            }
                          />

                          <div style={rs.ticketDivider} />

                          <TicketRow label="Reservation fee" value={fee ? eur(fee.base) : "—"} />
                          {fee && fee.discount > 0 && (
                            <TicketRow
                              label={`${PLAN_NAMES[planTier] || planTier} discount`}
                              value={`- ${eur(fee.discount)}`}
                              green
                            />
                          )}
                          <TicketRow label="Total today" value={fee ? (fee.total > 0 ? eur(fee.total) : "FREE") : "—"} strong />
                        </div>

                        {notEnoughWallet && (
                          <div style={rs.warnBox}>
                            Your wallet ({eur(walletBalance)}) does not cover the {eur(fee.total)} fee.{" "}
                            {onNavigate && (
                              <button type="button" style={rs.noticeLink} onClick={() => onNavigate("dashboard")}>
                                Top up
                              </button>
                            )}
                          </div>
                        )}

                        <button
                          type="button"
                          disabled={!selectedPort || busy || notEnoughWallet}
                          onClick={confirmBooking}
                          style={{
                            ...rs.confirmButton,
                            opacity: !selectedPort || busy || notEnoughWallet ? 0.55 : 1,
                            cursor: !selectedPort || busy || notEnoughWallet ? "not-allowed" : "pointer",
                          }}
                        >
                          {busy ? "Booking…" : selectedPort ? `RESERVE ${selectedPort.label.toUpperCase()}` : "SELECT A BAY"}
                        </button>

                        {bestPort && !selectedPort && (
                          <div style={rs.footNote}>
                            Tip: {bestPort.label} is currently the best pick (fastest connector, {bestPort.state === "AVAILABLE" ? "free right now" : "open for your slot"}).
                          </div>
                        )}

                        {benefits && (
                          <div style={rs.footNote}>
                            Free cancellation until {benefits.freeCancelMinutes} min before start.
                          </div>
                        )}
                      </>
                    )}
                  </section>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   SUB-COMPONENTS
========================================================= */

function Fact({ label, value }) {
  return (
    <div style={rs.fact}>
      <div style={rs.factLabel}>{label}</div>
      <div style={rs.factValue}>{value}</div>
    </div>
  );
}

function TicketRow({ label, value, strong, green }) {
  return (
    <div style={rs.ticketRow}>
      <span style={rs.ticketLabel}>{label}</span>
      <span
        style={{
          ...rs.ticketValue,
          fontWeight: strong ? 900 : 700,
          color: green ? "#047857" : "#0F172A",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ConfirmedTicket({ reservation, onDone, onMine }) {
  return (
    <div>
      <div style={{ ...rs.ticketTop, background: "#047857" }}>
        <div style={rs.ticketEyebrow}>✓ RESERVATION CONFIRMED</div>
        <div style={rs.ticketStation}>{reservation.stationName}</div>
      </div>

      <div style={rs.ticketPerf} />

      <div style={rs.ticketBody}>
        <div style={rs.code}>{reservation.code}</div>
        <TicketRow label="Bay" value={reservation.portLabel} strong />
        <TicketRow label="Connector" value={String(reservation.connectorType || "—").replace(/_/g, " ")} />
        <TicketRow label="Arrive" value={fmtWhen(reservation.startAt)} />
        <TicketRow label="Hold until" value={fmtClock(reservation.endAt)} />
        <TicketRow label="Fee charged" value={reservation.feeCharged > 0 ? eur(reservation.feeCharged) : "FREE"} />
      </div>

      <div style={{ display: "flex", gap: 8, padding: "0 16px 16px" }}>
        <button type="button" style={rs.ghostButton} onClick={onDone}>
          Book another
        </button>
        <button type="button" style={rs.smallConfirm} onClick={onMine}>
          View my tickets
        </button>
      </div>
    </div>
  );
}

function MyReservations({ data, loading, onCancel, onBook }) {
  const list = data?.reservations || [];

  if (loading && !data) return <section style={rs.card}><div style={rs.empty}>Loading your reservations…</div></section>;

  if (list.length === 0) {
    return (
      <section style={rs.card}>
        <div style={rs.empty}>
          You have no reservations yet.
          <div style={{ marginTop: 10 }}>
            <button type="button" style={rs.smallConfirm} onClick={onBook}>
              Book a port
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14 }}>
      {list.map((r) => {
        const st = RES_STATUS[r.status] || RES_STATUS.COMPLETED;

        return (
          <section key={r.id} style={{ ...rs.card, marginBottom: 0, opacity: r.status === "CANCELLED" ? 0.7 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <span style={{ ...rs.statusPill, background: st.bg, color: st.fg }}>{st.label}</span>
              <span style={rs.codeSmall}>{r.code}</span>
            </div>

            <div style={{ ...rs.cardTitle, marginTop: 10 }}>{r.stationName}</div>
            <div style={rs.stationSub}>{r.stationAddress || "Address unavailable"}</div>

            <div style={rs.ticketDivider} />

            <TicketRow label="Bay" value={r.portLabel} strong />
            <TicketRow label="Connector" value={`${String(r.connectorType || "—").replace(/_/g, " ")}${num(r.powerKw) !== null ? ` • ${r.powerKw} kW` : ""}`} />
            <TicketRow label="Arrive" value={fmtWhen(r.startAt)} />
            <TicketRow label="Until" value={fmtClock(r.endAt)} />
            <TicketRow label="Fee" value={r.feeCharged > 0 ? eur(r.feeCharged) : "FREE"} />
            {r.refunded > 0 && <TicketRow label="Refunded" value={eur(r.refunded)} green />}

            {r.canCancel && (
              <button type="button" style={rs.cancelButton} onClick={() => onCancel(r)}>
                {r.refundIfCancelled > 0 ? `Cancel & refund ${eur(r.refundIfCancelled)}` : "Cancel reservation"}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

/* =========================================================
   STYLES
========================================================= */

const rs = {
  pageHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 12 },
  eyebrow: { color: "#94A3B8", fontSize: 9, fontWeight: 900, letterSpacing: ".15em" },
  pageTitle: { fontSize: 22, fontWeight: 900, marginTop: 3, color: "#0F172A" },
  tabs: { display: "flex", gap: 6, background: "#E2E8F0", padding: 4, borderRadius: 10 },
  tab: { border: "none", background: "transparent", padding: "8px 14px", borderRadius: 8, fontSize: 11, fontWeight: 800, color: "#475569", cursor: "pointer" },
  tabActive: { background: "#111827", color: "#FFFFFF" },

  planStrip: { background: "#111827", color: "#E2E8F0", borderRadius: 14, padding: "12px 16px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" },
  planBadge: { background: "#F59E0B", color: "#111827", borderRadius: 999, padding: "4px 10px", fontSize: 10, fontWeight: 900, marginRight: 10 },
  planText: { fontSize: 11, color: "#CBD5E1" },
  walletChip: { background: "rgba(250,204,21,.14)", color: "#FDE68A", borderRadius: 999, padding: "6px 10px", fontSize: 10, fontWeight: 800 },
  upgradeButton: { border: "none", background: "#FFFFFF", color: "#111827", borderRadius: 8, padding: "7px 11px", fontSize: 10, fontWeight: 900, cursor: "pointer" },

  noticeOk: { background: "#ECFDF5", border: "1px solid #A7F3D0", color: "#047857", borderRadius: 12, padding: "10px 14px", marginBottom: 14, fontSize: 12, fontWeight: 700, display: "flex", justifyContent: "space-between", gap: 10 },
  noticeError: { background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", borderRadius: 12, padding: "10px 14px", marginBottom: 14, fontSize: 12, fontWeight: 700, display: "flex", justifyContent: "space-between", gap: 10 },
  noticeLink: { border: "none", background: "transparent", color: "inherit", textDecoration: "underline", cursor: "pointer", fontWeight: 900, fontSize: 12, padding: 0 },

  card: { background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 16, padding: 16, marginBottom: 14, boxShadow: "0 5px 18px rgba(15,23,42,.035)" },
  cardTitle: { fontWeight: 850, fontSize: 16, marginTop: 3, color: "#0F172A" },
  empty: { background: "#F8FAFC", border: "1px dashed #CBD5E1", borderRadius: 11, padding: 20, textAlign: "center", color: "#64748B", fontSize: 12, marginTop: 10 },
  errorBox: { background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", borderRadius: 10, padding: "9px 10px", fontSize: 11, marginTop: 10 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #CBD5E1", borderRadius: 9, padding: 10, fontSize: 12, marginTop: 10 },

  chipRow: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 },
  chip: { border: "1px solid #E2E8F0", background: "#FFFFFF", color: "#475569", borderRadius: 8, padding: "7px 10px", fontSize: 10, fontWeight: 800, cursor: "pointer" },
  chipActive: { background: "#111827", color: "#FFFFFF", borderColor: "#111827" },

  stationList: { marginTop: 10, maxHeight: 620, overflowY: "auto", display: "flex", flexDirection: "column", gap: 7 },
  stationRow: { width: "100%", textAlign: "left", border: "1px solid #E2E8F0", background: "#FFFFFF", borderRadius: 11, padding: 10, display: "flex", gap: 10, alignItems: "center", cursor: "pointer" },
  stationRowActive: { border: "1px solid #F59E0B", boxShadow: "0 0 0 2px rgba(245,158,11,.12)" },
  stationName: { fontWeight: 850, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#0F172A" },
  stationSub: { color: "#64748B", fontSize: 10, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" },
  stationPorts: { fontSize: 11, fontWeight: 900, color: "#047857" },
  topBadge: { background: "#F59E0B", color: "#111827", borderRadius: 4, padding: "2px 5px", fontSize: 8, fontWeight: 900, marginRight: 6 },

  factGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8, marginTop: 14 },
  fact: { background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: 9 },
  factLabel: { color: "#94A3B8", fontSize: 8, fontWeight: 900 },
  factValue: { marginTop: 4, fontSize: 11, fontWeight: 850, color: "#0F172A" },

  windowText: { marginTop: 12, fontSize: 12, color: "#334155", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 9, padding: "8px 10px" },

  autoButton: { border: "1px solid #F59E0B", background: "#FFFBEB", color: "#92400E", borderRadius: 9, padding: "8px 11px", fontSize: 10, fontWeight: 900, cursor: "pointer" },

  groupBox: { border: "1px solid #E2E8F0", borderRadius: 12, padding: 12, marginTop: 12, background: "#FCFDFE" },
  groupHead: { display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 },
  groupTitle: { fontWeight: 900, fontSize: 13, color: "#0F172A" },
  portGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(66px,1fr))", gap: 8 },
  port: { position: "relative", border: "2px solid", borderRadius: 12, padding: "12px 4px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, fontFamily: "inherit" },
  portLabel: { fontSize: 13, fontWeight: 900 },
  portTag: { fontSize: 7, fontWeight: 900, letterSpacing: ".06em" },
  bestTag: { position: "absolute", top: -8, left: "50%", transform: "translateX(-50%)", background: "#F59E0B", color: "#111827", borderRadius: 999, padding: "2px 6px", fontSize: 8, fontWeight: 900 },

  legend: { display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14 },
  legendItem: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9, fontWeight: 800, color: "#64748B" },
  legendDot: { width: 12, height: 12, borderRadius: 4, border: "2px solid" },
  footNote: { marginTop: 12, fontSize: 10, color: "#64748B", lineHeight: 1.5 },

  ticket: { background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 16, marginBottom: 14, overflow: "hidden", boxShadow: "0 8px 26px rgba(15,23,42,.08)", position: "sticky", top: 12 },
  ticketTop: { background: "#111827", color: "#FFFFFF", padding: "14px 16px" },
  ticketEyebrow: { fontSize: 9, fontWeight: 900, letterSpacing: ".16em", color: "#FCD34D" },
  ticketStation: { fontSize: 15, fontWeight: 850, marginTop: 4 },
  ticketPerf: { borderTop: "2px dashed #CBD5E1", margin: "0 12px" },
  ticketBody: { padding: "12px 16px" },
  ticketRow: { display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", fontSize: 11 },
  ticketLabel: { color: "#64748B" },
  ticketValue: { textAlign: "right" },
  ticketDivider: { height: 1, background: "#E2E8F0", margin: "8px 0" },
  confirmButton: { width: "calc(100% - 32px)", margin: "0 16px 14px", border: "none", background: "#10B981", color: "#FFFFFF", padding: 13, borderRadius: 10, fontWeight: 900, fontSize: 11, letterSpacing: ".04em" },
  warnBox: { margin: "0 16px 12px", background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", borderRadius: 9, padding: "8px 10px", fontSize: 11 },

  code: { fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 24, fontWeight: 900, letterSpacing: ".12em", textAlign: "center", padding: "6px 0 12px", color: "#047857" },
  codeSmall: { fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 12, fontWeight: 900, letterSpacing: ".08em", color: "#0F172A" },
  statusPill: { borderRadius: 999, padding: "4px 9px", fontSize: 9, fontWeight: 900 },
  ghostButton: { flex: 1, border: "1px solid #CBD5E1", background: "#FFFFFF", color: "#334155", borderRadius: 9, padding: 10, fontSize: 10, fontWeight: 800, cursor: "pointer" },
  smallConfirm: { flex: 1, border: "none", background: "#111827", color: "#FFFFFF", borderRadius: 9, padding: "10px 14px", fontSize: 10, fontWeight: 800, cursor: "pointer" },
  cancelButton: { width: "100%", marginTop: 10, border: "1px solid #FCA5A5", background: "#FFFFFF", color: "#B91C1C", borderRadius: 9, padding: 10, fontSize: 10, fontWeight: 800, cursor: "pointer" },
};
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  MapContainer,
  Marker,
  Popup,
  Polyline,
  TileLayer,
  useMap,
  CircleMarker,
} from "react-leaflet";

import L from "leaflet";
import "leaflet/dist/leaflet.css";

/*
=========================================================
 TRUSTCHARGE — LIVE EV TRIP SIMULATION + COMPANION
 --------------------------------------------------------
 - Real road route (backend /api/route, OSRM)
 - Live charging stations along that route
 - Live availability re-checked before every stop
 - Car drives the route (accelerated), charges (with taper)
 - Live restaurants (backend /api/nearby-restaurants)
 - Gemini companion (backend /api/ai/assistant)
 - Wallet: charging is limited to what the wallet covers. When
   the wallet is empty the trip pauses and the user can top up
   with Mollie (opens in a new tab, balance is detected
   automatically and charging resumes).
 - On arrival: battery, position and cost are saved
   (POST /api/simulate/complete).
=========================================================
*/

const DEFAULT_API_BASE_URL =
  import.meta.env?.VITE_API_BASE_URL || "http://localhost:5000";

const DEFAULT_RESERVE_PERCENT = 10;
const DEFAULT_TARGET_PERCENT = 80;
const DEFAULT_MAX_CHARGE_KW = 100;
const ASSUMED_STATION_KW = 11;
const DEFAULT_SPEED_KMH = 85;
const CHARGE_EFFICIENCY = 0.92;
const TAPER_SOC = 0.8;
const TAPER_FACTOR = 0.4;
const CORRIDOR_KM = 4;
const WALK_KMH = 4.8;

const TOPUP_AMOUNTS = [5, 10, 25, 50];
const TOPUP_POLL_MS = 4000;
const TOPUP_POLL_MAX_TRIES = 90;
const WALLET_EMPTY_EUR = 0.005;

/* =========================================================
   BASIC HELPERS
========================================================= */

function safeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const n = safeNumber(value);
    if (n !== null) return n;
  }
  return null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function formatNumber(value, digits = 1) {
  const n = safeNumber(value);
  return n === null ? "—" : n.toFixed(digits);
}

function formatKm(value) {
  const n = safeNumber(value);
  return n === null ? "—" : `${n.toFixed(1)} km`;
}

function formatEuro(value) {
  const n = safeNumber(value);
  return n === null ? "—" : `€${n.toFixed(2)}`;
}

function formatMinutes(value) {
  const n = safeNumber(value);
  if (n === null) return "—";
  if (n < 60) return `${Math.max(0, Math.round(n))} min`;
  const h = Math.floor(n / 60);
  const m = Math.round(n % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

function formatPrice(price) {
  return price === null || price === undefined
    ? "Price unavailable"
    : `€${Number(price).toFixed(3)} / kWh`;
}

/* =========================================================
   GEOMETRY (points are [lat, lng])
========================================================= */

function haversineKm(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) *
      Math.cos((b[0] * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function bearing(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x =
    Math.cos(rad(a[0])) * Math.sin(rad(b[0])) -
    Math.sin(rad(a[0])) *
      Math.cos(rad(b[0])) *
      Math.cos(rad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function buildRoute(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i += 1) {
    cum.push(cum[i - 1] + haversineKm(coords[i - 1], coords[i]));
  }
  return { coords, cum, total: cum[cum.length - 1] };
}

function pointAt(route, km) {
  const { coords, cum, total } = route;
  const t = clamp(km, 0, total);
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= t) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  const f = seg > 0 ? (t - cum[lo]) / seg : 0;
  const a = coords[lo];
  const b = coords[hi];
  return {
    pos: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
    idx: lo,
    heading: bearing(a, b),
  };
}

function projectOnRoute(route, p) {
  const { coords, cum } = route;
  const kx = 111.32 * Math.cos((p[0] * Math.PI) / 180);
  const ky = 110.574;
  let best = { distKm: Infinity, alongKm: 0 };

  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1];
    const b = coords[i];
    const ax = (a[1] - p[1]) * kx;
    const ay = (a[0] - p[0]) * ky;
    const bx = (b[1] - p[1]) * kx;
    const by = (b[0] - p[0]) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.distKm) {
      best = { distKm: d, alongKm: cum[i - 1] + t * (cum[i] - cum[i - 1]) };
    }
  }
  return best;
}

/* =========================================================
   STATIONS
========================================================= */

function normaliseStation(raw) {
  if (!raw) return null;
  const lat = firstNumber(raw.latitude, raw.lat);
  const lng = firstNumber(raw.longitude, raw.lng, raw.lon);
  if (lat === null || lng === null) return null;

  return {
    ...raw,
    _key: String(raw.id ?? `${lat.toFixed(5)},${lng.toFixed(5)}`),
    _lat: lat,
    _lng: lng,
    _name: raw.name || raw.operator || "Charging station",
    _status: String(raw.status || "UNKNOWN").toUpperCase(),
    _available: firstNumber(raw.availablePorts, raw.available),
    _total: firstNumber(raw.totalPorts, raw.total),
    _powerKw: firstNumber(raw.powerKw),
    _price: firstNumber(raw.pricePerKwh),
    _reliability: firstNumber(raw.reliability),
  };
}

function isUsable(station) {
  if (!station) return false;
  if (station._status === "OUT_OF_SERVICE") return false;
  if (station._available === 0) return false;
  return true;
}

function availabilityLabel(station) {
  if (station._available !== null && station._total !== null) {
    return `${station._available} / ${station._total} ports free`;
  }
  if (station._status === "OUT_OF_SERVICE") return "Out of service";
  return "Live ports unknown";
}

function leanStation(s) {
  if (!s) return null;
  return {
    id: s.id ?? s._key,
    name: s._name,
    operator: s.operator || null,
    routeKm: s._routeKm !== undefined ? round(s._routeKm, 1) : null,
    status: s._status,
    availablePorts: s._available,
    totalPorts: s._total,
    powerKw: s._powerKw,
    pricePerKwh: s._price,
    reliability: s._reliability,
    reliabilityStars: s.reliabilityStars ?? null,
    observationCount: s.observationCount ?? null,
  };
}

/* =========================================================
   CHARGING MODEL
========================================================= */

function chargePowerNow(ratedKw, soc) {
  return (soc >= TAPER_SOC ? ratedKw * TAPER_FACTOR : ratedKw) * CHARGE_EFFICIENCY;
}

function estimateChargeMinutes(fromKwh, toKwh, ratedKw, capacityKwh) {
  if (toKwh <= fromKwh || ratedKw <= 0) return 0;
  const knee = capacityKwh * TAPER_SOC;
  const fast = Math.max(0, Math.min(toKwh, knee) - fromKwh);
  const slow = Math.max(0, toKwh - Math.max(fromKwh, knee));
  return (
    (fast / (ratedKw * CHARGE_EFFICIENCY)) * 60 +
    (slow / (ratedKw * TAPER_FACTOR * CHARGE_EFFICIENCY)) * 60
  );
}

/* =========================================================
   CHARGING PLANNER (pure)
========================================================= */

function planStops({
  route,
  stations,
  startKm,
  startKwh,
  cap,
  cons,
  reservePct,
  targetPct,
  maxKw,
  fallbackTariff,
  exclude,
  terminal,
}) {
  const perKm = cons / 100;
  const reserveKwh = (cap * reservePct) / 100;
  const targetKwh = (cap * targetPct) / 100;
  const total = route.total;
  const stops = [];

  const describe = (station, atKm, arrivalKwh, chargeToKwh, extra = {}) => {
    const rated = Math.min(
      station._powerKw && station._powerKw > 0
        ? station._powerKw
        : ASSUMED_STATION_KW,
      maxKw
    );
    const chargeKwh = Math.max(0, chargeToKwh - arrivalKwh);
    const price =
      station._price !== null
        ? station._price
        : fallbackTariff > 0
        ? fallbackTariff
        : null;

    return {
      station,
      atKm,
      arrivalKwh,
      arrivalPct: (arrivalKwh / cap) * 100,
      chargeToKwh: Math.max(arrivalKwh, chargeToKwh),
      chargeToPct: (Math.max(arrivalKwh, chargeToKwh) / cap) * 100,
      chargeKwh,
      estMinutes: estimateChargeMinutes(arrivalKwh, chargeToKwh, rated, cap),
      estCost: price !== null ? chargeKwh * price : null,
      powerAssumed: !(station._powerKw && station._powerKw > 0),
      ...extra,
    };
  };

  let km = startKm;
  let kwh = startKwh;

  for (let guard = 0; guard < 14; guard += 1) {
    const reachKm = Math.max(0, (kwh - reserveKwh) / perKm);

    if (total - km <= reachKm) {
      if (terminal) {
        const arrivalKwh = kwh - (total - km) * perKm;
        stops.push(
          describe(terminal, total, arrivalKwh, Math.max(arrivalKwh, targetKwh), {
            final: true,
          })
        );
      }
      return { stops, feasible: true };
    }

    const maxKm = km + reachKm;

    const candidates = stations.filter((s) => {
      if (exclude?.has(s._key)) return false;
      if (s._routeKm <= km + 1) return false;
      if (s._routeKm > maxKm) return false;
      if (s._routeKm >= total - 0.5) return false;
      if (!isUsable(s)) return false;
      const arrival = kwh - (s._routeKm - km) * perKm;
      return arrival < targetKwh - 1;
    });

    if (!candidates.length) return { stops, feasible: false };

    const score = (s) =>
      ((s._routeKm - km) / Math.max(reachKm, 1)) * 50 +
      (s._reliability ?? 40) * 0.3 +
      (Math.min(s._powerKw ?? 22, 150) / 150) * 20 +
      (s._available > 0 ? 5 : 0);

    const pick = candidates.reduce((a, b) => (score(b) > score(a) ? b : a));

    const arrivalKwh = kwh - (pick._routeKm - km) * perKm;
    const remaining = total - pick._routeKm;
    const needed = remaining * perKm + reserveKwh + cap * 0.05;
    const chargeTo = clamp(Math.min(targetKwh, needed), arrivalKwh, cap);

    stops.push(describe(pick, pick._routeKm, arrivalKwh, chargeTo));

    km = pick._routeKm;
    kwh = chargeTo;
  }

  return { stops, feasible: false };
}

/* =========================================================
   API
========================================================= */

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error(
      data?.error || data?.message || `Request failed (${response.status})`
    );
  }
  return data;
}

function newTripId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `trip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* =========================================================
   MAP ICONS
========================================================= */

const iconCache = new Map();

function cachedIcon(key, build) {
  if (!iconCache.has(key)) iconCache.set(key, build());
  return iconCache.get(key);
}

function stationMarkerIcon(usable, highlighted) {
  const bg = highlighted ? "#F59E0B" : usable ? "#16A34A" : "#DC2626";
  return cachedIcon(`st-${bg}`, () =>
    L.divIcon({
      className: "tc-station-marker",
      html: `<div style="width:28px;height:28px;border-radius:50%;background:${bg};border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:13px">⚡</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    })
  );
}

function restaurantIcon(selected) {
  return cachedIcon(`rest-${selected}`, () =>
    L.divIcon({
      className: "tc-rest-marker",
      html: `<div style="width:26px;height:26px;border-radius:8px;background:${
        selected ? "#F59E0B" : "#fff"
      };border:2px solid #111827;box-shadow:0 3px 10px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:13px">🍴</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    })
  );
}

const startIcon = L.divIcon({
  className: "tc-start-marker",
  html: `<div style="width:16px;height:16px;border-radius:50%;background:#111827;border:4px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.35)"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const destinationIcon = L.divIcon({
  className: "tc-destination-marker",
  html: `<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;background:#F59E0B;border:3px solid #fff;transform:rotate(-45deg);box-shadow:0 4px 14px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);font-size:13px">🏁</span></div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 30],
});

function carIcon(heading) {
  const h = Math.round(heading / 15) * 15;
  return cachedIcon(`car-${h}`, () =>
    L.divIcon({
      className: "tc-car-marker",
      html: `<div style="width:42px;height:42px;border-radius:50%;background:#111827;border:4px solid #FACC15;box-shadow:0 0 0 6px rgba(250,204,21,.22),0 5px 18px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center"><div style="transform:rotate(${h}deg);color:#FACC15;font-size:18px;line-height:1">▲</div></div>`,
      iconSize: [42, 42],
      iconAnchor: [21, 21],
    })
  );
}

/* =========================================================
   MAP HELPERS
========================================================= */

function MapFit({ points, fitKey, enabled }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled || !points || points.length < 2) return;
    try {
      map.fitBounds(L.latLngBounds(points), {
        padding: [40, 40],
        maxZoom: 13,
        animate: false,
      });
    } catch {
      /* non-critical */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, enabled, map]);

  return null;
}

function MapFollow({ lat, lng, follow }) {
  const map = useMap();
  const zoomed = useRef(false);

  useEffect(() => {
    if (!follow) {
      zoomed.current = false;
      return;
    }
    if (lat === null || lat === undefined || lng === null || lng === undefined) {
      return;
    }
    if (!zoomed.current) {
      map.setView([lat, lng], Math.max(map.getZoom(), 12), { animate: false });
      zoomed.current = true;
    } else {
      map.panTo([lat, lng], { animate: false });
    }
  }, [lat, lng, follow, map]);

  return null;
}

function StarsInput({ onRate, disabled }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="tc-stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          className={n <= hover ? "on" : ""}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onRate(n)}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

/* =========================================================
   MAIN COMPONENT
========================================================= */

export default function Simulation({
  station: initialStationRaw,
  currentCoords: suppliedCoords,
  apiBaseUrl,
  firebaseUid,
  vehicle,
  telemetry,
  wallet,
  onClose,
  onTripComplete,
  onOpenExternalMaps,
  onWalletUpdate,
}) {
  const api = apiBaseUrl || DEFAULT_API_BASE_URL;

  /* ------------------- vehicle model (from telemetry) ------------------- */

  const tPct = firstNumber(telemetry?.batteryPercent);
  const tKwh = firstNumber(telemetry?.batteryKwh);
  const tRange = firstNumber(telemetry?.rangeKm);

  const derivedCap =
    tKwh !== null && tPct !== null && tPct >= 5 ? tKwh / (tPct / 100) : null;
  const derivedCons =
    tKwh !== null && tRange !== null && tRange > 0 ? (tKwh / tRange) * 100 : null;

  const assumed = useMemo(
    () => ({
      capacity: derivedCap === null,
      consumption: derivedCons === null,
      battery: tPct === null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [capacity, setCapacity] = useState(() =>
    derivedCap !== null ? round(derivedCap, 1) : 60
  );
  const [startPct, setStartPct] = useState(() =>
    tPct !== null ? clamp(round(tPct, 0), 1, 100) : 50
  );
  const [consumption, setConsumption] = useState(() =>
    derivedCons !== null ? round(derivedCons, 1) : 18
  );
  const [reserve, setReserve] = useState(DEFAULT_RESERVE_PERCENT);
  const [target, setTarget] = useState(DEFAULT_TARGET_PERCENT);
  const [maxChargeKw, setMaxChargeKw] = useState(DEFAULT_MAX_CHARGE_KW);
  const [fallbackTariff, setFallbackTariff] = useState(0);
  const [timeScale, setTimeScale] = useState(30);

  /* ------------------- trip state ------------------- */

  const [terminalStation, setTerminalStation] = useState(() =>
    initialStationRaw ? normaliseStation(initialStationRaw) : null
  );

  const [origin, setOrigin] = useState(() => {
    const lat = firstNumber(suppliedCoords?.lat, suppliedCoords?.latitude);
    const lng = firstNumber(
      suppliedCoords?.lng,
      suppliedCoords?.lon,
      suppliedCoords?.longitude
    );
    return lat !== null && lng !== null ? { lat, lng } : null;
  });

  const [phase, setPhase] = useState("PLAN"); // PLAN | READY | RUN | DONE
  const [destinationQuery, setDestinationQuery] = useState(
    initialStationRaw?.name || ""
  );
  const [geoResults, setGeoResults] = useState([]);
  const [destination, setDestination] = useState(null);
  const [destinationLabel, setDestinationLabel] = useState("");
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState("");

  const [route, setRoute] = useState(null);
  const [routeDurationMin, setRouteDurationMin] = useState(null);
  const [routeVersion, setRouteVersion] = useState(0);
  const [stations, setStations] = useState([]);
  const [stationsLoading, setStationsLoading] = useState(false);
  const [stationsNote, setStationsNote] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);

  const [follow, setFollow] = useState(true);

  /* ------------------- live run state ------------------- */

  const simRef = useRef({
    running: false,
    mode: "idle", // idle | driving | checking | charging | blocked | topup | stranded | arrived | stopped
    km: 0,
    kwh: 0,
    elapsed: 0,
    stops: [],
    charge: null,
    lastTs: 0,
    lastRender: 0,
    lastNarrationKm: 0,
    lastRestKm: -999,
    lastRestAt: 0,
    lowWarned: false,
    near: new Set(),
    look: new Set(),
    walletWarn: new Set(),
  });

  const rafRef = useRef(null);
  const stepRef = useRef(null);
  const loopRef = useRef((ts) => stepRef.current?.(ts));
  const excludedRef = useRef(new Set());
  const sessionsRef = useRef([]);
  const tripIdRef = useRef(newTripId());
  const savingRef = useRef(false);
  const walletStartRef = useRef(Number(wallet?.balance || 0));
  const serverBalanceRef = useRef(Number(wallet?.balance || 0));
  const feedIdRef = useRef(0);
  const chatHistoryRef = useRef([]);
  const stationsRef = useRef([]);
  const restaurantsRef = useRef([]);
  const topupTimerRef = useRef(null);
  const topupPaymentRef = useRef(null);
  const topupCheckRef = useRef(null);
  const resumeRef = useRef(null);

  const [snap, setSnap] = useState({
    km: 0,
    kwh: (60 * 50) / 100,
    elapsed: 0,
    mode: "idle",
    running: false,
    charge: null,
  });

  const [remainingStops, setRemainingStops] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [saveState, setSaveState] = useState({ status: "idle" });
  const [feed, setFeed] = useState([]);
  const [ratePrompt, setRatePrompt] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");

  const [topup, setTopup] = useState({
    status: "idle", // idle | creating | waiting | paid | error
    amount: 10,
    url: null,
    message: "",
  });

  const [rest, setRest] = useState({
    items: [],
    loading: false,
    error: "",
    label: "",
    radius: 900,
  });
  const [selectedRestaurant, setSelectedRestaurant] = useState(null);
  const [showRestaurants, setShowRestaurants] = useState(true);

  stationsRef.current = stations;
  restaurantsRef.current = rest.items;

  /* ------------------- derived values ------------------- */

  const avgSpeed = useMemo(() => {
    if (route && routeDurationMin && routeDurationMin > 0) {
      return clamp(route.total / (routeDurationMin / 60), 30, 130);
    }
    return DEFAULT_SPEED_KMH;
  }, [route, routeDurationMin]);

  const plan = useMemo(() => {
    if (!route) return null;
    return planStops({
      route,
      stations,
      startKm: 0,
      startKwh: (capacity * startPct) / 100,
      cap: capacity,
      cons: consumption,
      reservePct: reserve,
      targetPct: target,
      maxKw: maxChargeKw,
      fallbackTariff,
      exclude: new Set(),
      terminal: terminalStation,
    });
  }, [
    route,
    stations,
    capacity,
    startPct,
    consumption,
    reserve,
    target,
    maxChargeKw,
    fallbackTariff,
    terminalStation,
  ]);

  const running = phase === "RUN" || phase === "DONE";
  const batteryPct = running
    ? clamp((snap.kwh / capacity) * 100, 0, 100)
    : startPct;

  const carState = useMemo(() => {
    if (!route) return null;
    return pointAt(route, running ? snap.km : 0);
  }, [route, running, snap.km]);

  const carPos = carState
    ? carState.pos
    : origin
    ? [origin.lat, origin.lng]
    : null;

  const stopsForView = phase === "RUN" ? remainingStops : plan?.stops || [];
  const nextStop = stopsForView[0] || null;

  const remainingKm = route ? Math.max(0, route.total - (running ? snap.km : 0)) : 0;
  const remainingChargeMin = stopsForView.reduce(
    (sum, s) => sum + (s.estMinutes || 0),
    0
  );
  const etaMin = route ? (remainingKm / avgSpeed) * 60 + remainingChargeMin : null;

  const runningCost = useMemo(() => {
    let cost = sessions.reduce((sum, s) => sum + (s.costEur || 0), 0);
    const c = snap.charge;
    if (c && c.price !== null && c.price !== undefined) cost += c.done * c.price;
    return cost;
  }, [sessions, snap.charge]);

  const planCost = useMemo(() => {
    const list = plan?.stops || [];
    const priced = list.filter((s) => s.estCost !== null);
    return {
      total: priced.reduce((sum, s) => sum + s.estCost, 0),
      unpriced: list.length - priced.length,
    };
  }, [plan]);

  const walletBalance = Number(wallet?.balance || 0);
  const walletShown =
    saveState.status === "saved" && saveState.walletBalance !== null
      ? saveState.walletBalance
      : phase === "RUN" || phase === "DONE"
      ? Math.max(0, walletStartRef.current - runningCost)
      : walletBalance;

  // Wallet money left right now, from refs only (safe inside async callbacks).
  function walletLeftNow() {
    const spent = sessionsRef.current.reduce((sum, s) => sum + (s.costEur || 0), 0);
    return Math.max(0, walletStartRef.current - spent);
  }

  /* =========================================================
     FEED (companion log)
  ========================================================= */

  const pushFeed = useCallback((text, type = "info") => {
    feedIdRef.current += 1;
    const id = feedIdRef.current;
    const clock = formatMinutes(simRef.current.elapsed);
    setFeed((prev) => [{ id, text, type, clock }, ...prev].slice(0, 80));
  }, []);

  /* =========================================================
     RENDER PUBLISH (throttled)
  ========================================================= */

  function publish(force = false) {
    const s = simRef.current;
    const now = performance.now();
    if (!force && now - s.lastRender < 90) return;
    s.lastRender = now;
    setSnap({
      km: s.km,
      kwh: s.kwh,
      elapsed: s.elapsed,
      mode: s.mode,
      running: s.running,
      charge: s.charge ? { ...s.charge } : null,
    });
  }

  function startLoop() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    simRef.current.lastTs = performance.now();
    simRef.current.running = true;
    rafRef.current = requestAnimationFrame(loopRef.current);
  }

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      simRef.current.running = false;
      if (topupTimerRef.current) clearInterval(topupTimerRef.current);
    },
    []
  );

  /* =========================================================
     WALLET TOP-UP (Mollie)
  ========================================================= */

  // Keep our idea of the server balance in sync with what the dashboard passes.
  useEffect(() => {
    const b = Number(wallet?.balance);
    if (!Number.isFinite(b)) return;
    const delta = b - serverBalanceRef.current;
    if (delta > 0.004 && simRef.current.mode !== "idle") {
      walletStartRef.current += delta;
    }
    serverBalanceRef.current = b;
  }, [wallet?.balance]);

  function applyServerBalance(newBalance) {
    const delta = newBalance - serverBalanceRef.current;
    // During a trip the server balance is only debited when the trip is saved,
    // so any increase is fresh top-up money that can be spent right away.
    if (delta > 0.004 && simRef.current.mode !== "idle") {
      walletStartRef.current += delta;
    }
    serverBalanceRef.current = newBalance;
    onWalletUpdate?.(newBalance);
  }

  function stopTopupPolling() {
    if (topupTimerRef.current) {
      clearInterval(topupTimerRef.current);
      topupTimerRef.current = null;
    }
  }

  function pollTopup(balanceBefore) {
    stopTopupPolling();
    let tries = 0;

    const tick = async () => {
      tries += 1;
      try {
        const data = await fetchJson(
          `${api}/api/payments/status/${encodeURIComponent(firebaseUid)}`
        );
        const balance = safeNumber(data?.wallet?.balance);
        const latest = data?.latestTopup;

        if (balance !== null && balance > balanceBefore + 0.004) {
          stopTopupPolling();
          const added = balance - balanceBefore;
          applyServerBalance(balance);
          setTopup((t) => ({
            ...t,
            status: "paid",
            url: null,
            message: `${formatEuro(added)} added to your wallet.`,
          }));
          pushFeed(`Top-up received: ${formatEuro(added)} added to your wallet.`, "charge");
          if (simRef.current.mode === "topup") resumeRef.current?.();
          return;
        }

        if (
          latest &&
          latest.paymentId === topupPaymentRef.current &&
          ["failed", "canceled", "expired"].includes(latest.status)
        ) {
          stopTopupPolling();
          setTopup((t) => ({
            ...t,
            status: "error",
            url: null,
            message: `The payment was ${latest.status}. You have not been charged.`,
          }));
          return;
        }
      } catch {
        /* keep polling */
      }

      if (tries >= TOPUP_POLL_MAX_TRIES) {
        stopTopupPolling();
        setTopup((t) => ({
          ...t,
          status: "error",
          message: "No payment confirmation yet. If you paid, press “I've paid — check now”.",
        }));
      }
    };

    topupCheckRef.current = tick;
    topupTimerRef.current = setInterval(tick, TOPUP_POLL_MS);
  }

  async function startTopup() {
    if (!firebaseUid) {
      setTopup((t) => ({ ...t, status: "error", message: "No user account is linked to this session." }));
      return;
    }

    // Open the tab synchronously (inside the click) so popup blockers allow it.
    const payWindow = window.open("", "_blank");
    setTopup((t) => ({ ...t, status: "creating", message: "", url: null }));

    try {
      const balanceBefore = serverBalanceRef.current;
      const data = await fetchJson(`${api}/api/payments/create-topup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firebaseUid,
          amount: topup.amount,
          returnUrl: `${window.location.origin}${window.location.pathname}`,
        }),
      });

      if (!data?.checkoutUrl) throw new Error("No checkout URL received.");

      topupPaymentRef.current = data.paymentId || null;

      if (payWindow) payWindow.location.href = data.checkoutUrl;

      setTopup((t) => ({
        ...t,
        status: "waiting",
        url: data.checkoutUrl,
        message: payWindow
          ? "Complete the payment in the Mollie tab. This page updates automatically."
          : "Your browser blocked the payment tab. Use the link below to pay.",
      }));

      pollTopup(balanceBefore);
    } catch (error) {
      if (payWindow) payWindow.close();
      setTopup((t) => ({
        ...t,
        status: "error",
        url: null,
        message: error?.message || "Could not start the top-up.",
      }));
    }
  }

  function renderTopup(headline, detail) {
    const busy = topup.status === "creating" || topup.status === "waiting";
    return (
      <div className="tc-topup">
        <strong>{headline}</strong>
        {detail && <span>{detail}</span>}

        <div className="tc-topup-amounts">
          {TOPUP_AMOUNTS.map((a) => (
            <button
              key={a}
              type="button"
              disabled={busy}
              className={topup.amount === a ? "on" : ""}
              onClick={() => setTopup((t) => ({ ...t, amount: a }))}
            >
              €{a}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="tc-primary-button"
          disabled={busy || !firebaseUid}
          onClick={startTopup}
        >
          {topup.status === "creating"
            ? "Opening Mollie…"
            : `Top up €${topup.amount} with Mollie`}
        </button>

        {topup.message && (
          <div className={topup.status === "error" ? "tc-topup-msg err" : "tc-topup-msg"}>
            {topup.message}
          </div>
        )}

        {topup.status === "waiting" && (
          <div className="tc-topup-links">
            {topup.url && (
              <a href={topup.url} target="_blank" rel="noopener noreferrer">
                Open payment page again
              </a>
            )}
            <button
              type="button"
              className="tc-small-button"
              onClick={() => topupCheckRef.current?.()}
            >
              I've paid — check now
            </button>
          </div>
        )}
      </div>
    );
  }

  /* =========================================================
     GEOCODE / ROUTE / STATIONS
  ========================================================= */

  async function geocode(query) {
    const data = await fetchJson(
      `${api}/api/geocode?q=${encodeURIComponent(query.trim())}`
    );
    return (Array.isArray(data?.results) ? data.results : [])
      .map((r) => ({
        lat: firstNumber(r.lat, r.latitude),
        lng: firstNumber(r.lon, r.lng, r.longitude),
        label: r.display_name || r.name || query.trim(),
      }))
      .filter((r) => r.lat !== null && r.lng !== null);
  }

  async function fetchRoute(start, end) {
    const params = new URLSearchParams({
      startLat: String(start.lat),
      startLng: String(start.lng),
      endLat: String(end.lat),
      endLng: String(end.lng),
    });
    const data = await fetchJson(`${api}/api/route?${params.toString()}`);
    const coords = (data?.geometry?.coordinates || [])
      .map((c) => [safeNumber(c?.[1]), safeNumber(c?.[0])])
      .filter((c) => c[0] !== null && c[1] !== null);

    if (coords.length < 2) throw new Error("Live road route unavailable.");

    return {
      coords,
      durationMin: firstNumber(data?.durationMinutes),
    };
  }

  async function loadStationsAlongRoute(builtRoute) {
    setStationsLoading(true);
    setStationsNote("");

    try {
      const spacing = Math.max(25, builtRoute.total / 9);
      const points = [];
      for (let k = 0; k < builtRoute.total; k += spacing) {
        points.push(pointAt(builtRoute, k).pos);
      }
      points.push(pointAt(builtRoute, builtRoute.total).pos);

      const collected = [];
      let failures = 0;
      const batchSize = 3;

      for (let i = 0; i < points.length; i += batchSize) {
        const batch = points.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (p) => {
            try {
              const data = await fetchJson(
                `${api}/api/charging-stations?lat=${p[0]}&lng=${p[1]}&distance=15`
              );
              return Array.isArray(data?.stations) ? data.stations : [];
            } catch {
              failures += 1;
              return [];
            }
          })
        );
        results.forEach((list) => collected.push(...list));
      }

      const unique = new Map();
      collected.forEach((raw) => {
        const s = normaliseStation(raw);
        if (s && !unique.has(s._key)) unique.set(s._key, s);
      });

      const corridor = [...unique.values()]
        .map((s) => {
          const proj = projectOnRoute(builtRoute, [s._lat, s._lng]);
          return { ...s, _routeKm: proj.alongKm, _corridorKm: proj.distKm };
        })
        .filter((s) => s._corridorKm <= CORRIDOR_KM)
        .sort((a, b) => a._routeKm - b._routeKm);

      setStations(corridor);
      setLastRefresh(new Date());

      if (failures === points.length) {
        setStationsNote("Live station data is unavailable right now.");
      } else if (!corridor.length) {
        setStationsNote(
          `The live API answered, but no station is within ${CORRIDOR_KM} km of this road.`
        );
      } else if (failures > 0) {
        setStationsNote(
          `${failures} of ${points.length} station lookups failed; some stations may be missing.`
        );
      }

      return corridor;
    } finally {
      setStationsLoading(false);
    }
  }

  async function fetchLiveStation(station) {
    const data = await fetchJson(
      `${api}/api/charging-stations?lat=${station._lat}&lng=${station._lng}&distance=1`
    );
    const found = (data?.stations || []).find(
      (s) => String(s.id) === station._key
    );
    return found ? normaliseStation(found) : null;
  }

  async function planTripTo(place, fromOrigin = origin) {
    if (!fromOrigin) {
      setPlanError("Current vehicle location is unavailable.");
      return;
    }

    setPlanLoading(true);
    setPlanError("");
    setGeoResults([]);
    setStations([]);
    setStationsNote("");
    setSaveState({ status: "idle" });
    excludedRef.current = new Set();

    try {
      const dest = { lat: place.lat, lng: place.lng };
      const fetched = await fetchRoute(fromOrigin, dest);
      const built = buildRoute(fetched.coords);

      setDestination(dest);
      setDestinationLabel(place.label);
      setRoute(built);
      setRouteDurationMin(fetched.durationMin);
      setRouteVersion((v) => v + 1);
      setPhase("READY");
      setFollow(false);

      await loadStationsAlongRoute(built);
    } catch (error) {
      setPlanError(error?.message || "Trip planning failed.");
    } finally {
      setPlanLoading(false);
    }
  }

  async function submitDestination() {
    const q = destinationQuery.trim();
    if (!q) {
      setPlanError("Enter a destination first.");
      return;
    }
    setPlanLoading(true);
    setPlanError("");
    setGeoResults([]);

    try {
      const results = await geocode(q);
      if (!results.length) throw new Error("Could not find that destination.");
      if (results.length === 1) {
        setPlanLoading(false);
        await planTripTo(results[0]);
        return;
      }
      setGeoResults(results.slice(0, 5));
    } catch (error) {
      setPlanError(error?.message || "Destination search failed.");
    } finally {
      setPlanLoading(false);
    }
  }

  // Opened from a station: route straight to that station and charge there.
  useEffect(() => {
    if (terminalStation && origin) {
      planTripTo({
        lat: terminalStation._lat,
        lng: terminalStation._lng,
        label: terminalStation._name,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshStations() {
    if (!route) return;
    await loadStationsAlongRoute(route);
  }

  /* =========================================================
     RESTAURANTS (live, via backend: Overpass mirrors + TomTom)
  ========================================================= */

  async function requestRestaurants(point, radius) {
    const data = await fetchJson(
      `${api}/api/nearby-restaurants?lat=${point[0]}&lng=${point[1]}&radius=${radius}`
    );
    return (Array.isArray(data?.places) ? data.places : []).map((p) => ({
      ...p,
      walkMin: Math.max(1, Math.round((p.distanceKm / WALK_KMH) * 60)),
    }));
  }

  async function loadRestaurants(point, label) {
    if (!point) return [];
    setRest((r) => ({ ...r, loading: true, error: "", label }));

    try {
      let radius = 900;
      let items = [];

      try {
        items = await requestRestaurants(point, radius);
      } catch {
        // one quick retry: public Overpass servers are occasionally busy
        await new Promise((resolve) => setTimeout(resolve, 1200));
        items = await requestRestaurants(point, radius);
      }

      // Nothing walkable close by: widen the search once.
      if (!items.length) {
        radius = 2500;
        items = await requestRestaurants(point, radius);
      }

      setRest({ items, loading: false, error: "", label, radius });
      restaurantsRef.current = items;
      return items;
    } catch (error) {
      setRest({
        items: [],
        loading: false,
        error: error?.message || "Could not load restaurants.",
        label,
        radius: 900,
      });
      restaurantsRef.current = [];
      return [];
    }
  }

  function currentPos() {
    if (!route) return origin ? [origin.lat, origin.lng] : null;
    return pointAt(route, simRef.current.km).pos;
  }

  /* =========================================================
     GEMINI COMPANION
  ========================================================= */

  function localSuggestion(items, chargeMin) {
    if (!items.length) return "No restaurants were found within walking distance.";
    const fits = items.filter((r) => r.walkMin * 2 + 10 <= chargeMin);
    const pick = (fits.length ? fits : items)[0];
    return fits.length
      ? `${pick.name} is a ${pick.walkMin} min walk away and fits inside your ~${Math.round(
          chargeMin
        )} min charge.`
      : `${pick.name} is the closest option (${pick.walkMin} min walk), but it may be tight for your charge time.`;
  }

  async function askCompanion(message, opts = {}) {
    const { silentUser = false, restaurants, stopStation, chargeMin } = opts;
    if (!silentUser) pushFeed(message, "you");
    setAiLoading(true);

    const s = simRef.current;
    const pos = currentPos();
    const list = restaurants || restaurantsRef.current;

    const upcoming = stationsRef.current
      .filter((st) => st._routeKm >= s.km)
      .slice(0, 12)
      .map(leanStation);

    const context = {
      vehicle: vehicle || null,
      telemetry: {
        batteryPercent: round((s.kwh / capacity) * 100 || startPct, 1),
        batteryKwh: round(s.kwh, 1),
        rangeKm: round(Math.max(0, s.kwh / (consumption / 100)), 0),
        latitude: pos?.[0] ?? null,
        longitude: pos?.[1] ?? null,
        source: "TrustCharge live trip simulation",
      },
      selectedStation: leanStation(stopStation || s.stops[0]?.station),
      stations: upcoming,
      trip: {
        destination: destinationLabel,
        totalKm: route ? round(route.total, 1) : null,
        drivenKm: round(s.km, 1),
        remainingKm: route ? round(route.total - s.km, 1) : null,
        state: s.mode,
        elapsedMin: round(s.elapsed, 0),
        plannedStops: s.stops.map((st) => ({
          name: st.station._name,
          atKm: round(st.atKm, 1),
          arrivalPct: round(st.arrivalPct, 0),
          chargeToPct: round(st.chargeToPct, 0),
        })),
        chargingSessionsSoFar: sessionsRef.current,
        walletBalanceEur: round(walletLeftNow(), 2),
      },
      restaurants: list.slice(0, 12).map((r) => ({
        name: r.name,
        type: r.type,
        cuisine: r.cuisine,
        distanceKm: round(r.distanceKm, 2),
        walkMinutes: r.walkMin,
      })),
    };

    try {
      const data = await fetchJson(`${api}/api/ai/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: chatHistoryRef.current.slice(-8),
          context,
        }),
      });

      const answer = data?.answer || "No answer received.";
      chatHistoryRef.current.push(
        { role: "user", content: message },
        { role: "model", content: answer }
      );
      pushFeed(answer, "ai");
    } catch {
      pushFeed(
        chargeMin !== undefined
          ? localSuggestion(list, chargeMin)
          : "The companion could not reach live AI data. Nothing was made up.",
        "ai"
      );
    } finally {
      setAiLoading(false);
    }
  }

  function submitChat(event) {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text || aiLoading) return;
    setChatInput("");
    askCompanion(text);
  }

  /* =========================================================
     RE-PLANNING
  ========================================================= */

  function replanFromHere() {
    const s = simRef.current;
    return planStops({
      route,
      stations: stationsRef.current,
      startKm: s.km,
      startKwh: s.kwh,
      cap: capacity,
      cons: consumption,
      reservePct: reserve,
      targetPct: target,
      maxKw: maxChargeKw,
      fallbackTariff,
      exclude: excludedRef.current,
      terminal: terminalStation,
    });
  }

  async function lookAhead(stop) {
    const key = stop.station._key;
    let live = null;
    try {
      live = await fetchLiveStation(stop.station);
    } catch {
      return;
    }
    if (!live) return;

    const s = simRef.current;
    if (s.stops[0]?.station._key !== key) return;

    if (isUsable(live)) {
      stop.station = { ...stop.station, ...live, _routeKm: stop.station._routeKm };
      return;
    }

    excludedRef.current.add(key);
    const res = replanFromHere();
    if (res.stops.length && res.stops[0].station._key !== key) {
      s.stops = res.stops;
      setRemainingStops([...s.stops]);
      pushFeed(
        `${stop.station._name} just went ${
          live._status === "OUT_OF_SERVICE" ? "out of service" : "full"
        }. Re-routing to ${res.stops[0].station._name}.`,
        "warn"
      );
    } else {
      pushFeed(
        `${stop.station._name} is now unavailable and no alternative is in range yet. I will keep checking.`,
        "warn"
      );
    }
  }

  /* =========================================================
     DRIVE / CHARGE STEPS
  ========================================================= */

  function narrate(s, stop) {
    const pct = (s.kwh / capacity) * 100;

    if (s.km - s.lastNarrationKm >= 25) {
      s.lastNarrationKm = s.km;
      pushFeed(
        `${formatKm(s.km)} driven, battery ${Math.round(pct)}%. ${
          stop
            ? `Next charger: ${stop.station._name} in ${formatKm(stop.atKm - s.km)}.`
            : `Destination in ${formatKm(route.total - s.km)}.`
        }`,
        "drive"
      );
    }

    if (pct < 20 && !s.lowWarned) {
      s.lowWarned = true;
      pushFeed(`Battery is low (${Math.round(pct)}%).`, "warn");
    }

    if (stop) {
      const gap = stop.atKm - s.km;
      const key = stop.station._key;

      if (gap < 10 && !s.near.has(key)) {
        s.near.add(key);
        pushFeed(`Approaching ${stop.station._name} (${formatKm(gap)}).`, "drive");
      }
      if (gap < 25 && !s.look.has(key)) {
        s.look.add(key);
        lookAhead(stop);
      }

      // Early wallet warning so the user can top up before arriving.
      if (
        gap < 25 &&
        !s.walletWarn.has(key) &&
        stop.estCost !== null &&
        stop.estCost > walletLeftNow() + 0.005
      ) {
        s.walletWarn.add(key);
        pushFeed(
          `Your wallet (${formatEuro(walletLeftNow())}) may not cover the planned charge at ${
            stop.station._name
          } (~${formatEuro(stop.estCost)}). You can top up now.`,
          "warn"
        );
      }
    }

    if (s.km - s.lastRestKm >= 20 && performance.now() - s.lastRestAt > 20000) {
      s.lastRestKm = s.km;
      s.lastRestAt = performance.now();
      loadRestaurants(pointAt(route, s.km).pos, "Near your position");
    }
  }

  function driveStep(s, dtMin) {
    const perKm = consumption / 100;
    const stop = s.stops[0];
    const limit = stop ? Math.min(stop.atKm, route.total) : route.total;

    let next = Math.min(limit, s.km + (avgSpeed * dtMin) / 60);
    const maxByEnergy = s.kwh / perKm;
    if (next - s.km > maxByEnergy) next = s.km + maxByEnergy;

    s.kwh = Math.max(0, s.kwh - (next - s.km) * perKm);
    s.km = next;

    narrate(s, stop);

    if (s.kwh <= 0.001 && s.km < limit - 1e-6) {
      s.running = false;
      s.mode = "stranded";
      pushFeed(
        "The battery is empty before the next charger. Stop here and save, or change the plan.",
        "warn"
      );
      publish(true);
      return;
    }

    if (s.km >= limit - 1e-6) {
      if (stop) arriveAtStop();
      else arriveDestination();
    }
  }

  function chargeStep(s, dtMin) {
    const c = s.charge;
    if (!c) return;

    const soc = s.kwh / capacity;
    const kw = chargePowerNow(c.ratedKw, soc);
    const dk = Math.min(c.total - c.done, (kw * dtMin) / 60);

    c.done += dk;
    c.minutes += dtMin;
    c.currentKw = kw;
    s.kwh = Math.min(capacity, c.startKwh + c.done);

    if (c.done >= c.total - 1e-6) finishCharging();
  }

  stepRef.current = (ts) => {
    const s = simRef.current;
    if (!s.running) return;

    const dtReal = Math.min(0.25, Math.max(0, (ts - s.lastTs) / 1000));
    s.lastTs = ts;
    const dtMin = (dtReal * timeScale) / 60;
    s.elapsed += dtMin;

    if (s.mode === "driving") driveStep(s, dtMin);
    else if (s.mode === "charging") chargeStep(s, dtMin);

    publish();

    if (s.running) rafRef.current = requestAnimationFrame(loopRef.current);
  };

  /* =========================================================
     STOPS
  ========================================================= */

  async function arriveAtStop() {
    const s = simRef.current;
    s.running = false;
    s.mode = "checking";
    publish(true);

    const stop = s.stops[0];
    if (!stop) return;

    pushFeed(`Arrived at ${stop.station._name}. Checking live availability…`, "charge");

    let live = null;
    try {
      live = await fetchLiveStation(stop.station);
    } catch {
      /* fall through with what we know */
    }

    if (live) {
      stop.station = { ...stop.station, ...live, _routeKm: stop.station._routeKm };
    }

    if (!isUsable(stop.station)) {
      handleUnavailable(stop);
      return;
    }

    beginCharging(stop);
  }

  function handleUnavailable(stop) {
    const s = simRef.current;
    excludedRef.current.add(stop.station._key);

    if (!stop.final) {
      const res = replanFromHere();
      if (res.stops.length && res.stops[0].atKm > s.km + 0.5) {
        s.stops = res.stops;
        setRemainingStops([...s.stops]);
        s.mode = "driving";
        pushFeed(
          `${stop.station._name} is ${
            stop.station._status === "OUT_OF_SERVICE" ? "out of service" : "full"
          }. Heading on to ${res.stops[0].station._name}.`,
          "warn"
        );
        startLoop();
        return;
      }
    }

    s.mode = "blocked";
    s.running = false;
    pushFeed(
      `${stop.station._name} is ${
        stop.station._status === "OUT_OF_SERVICE" ? "out of service" : "full"
      } and there is no alternative in range. I will re-check every 15 seconds.`,
      "warn"
    );
    publish(true);
  }

  async function recheckBlocked() {
    const s = simRef.current;
    const stop = s.stops[0];
    if (!stop || s.mode !== "blocked") return;

    excludedRef.current.delete(stop.station._key);
    try {
      const live = await fetchLiveStation(stop.station);
      if (live) {
        stop.station = { ...stop.station, ...live, _routeKm: stop.station._routeKm };
      }
    } catch {
      return;
    }

    if (isUsable(stop.station)) {
      pushFeed(`${stop.station._name} is available again.`, "charge");
      beginCharging(stop);
    }
  }

  useEffect(() => {
    if (snap.mode !== "blocked") return undefined;
    const timer = setInterval(recheckBlocked, 15000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.mode]);

  // Wallet is empty at a charger: pause and wait for a top-up.
  function waitForTopup(stop, price, wanted) {
    const s = simRef.current;
    s.mode = "topup";
    s.running = false;
    pushFeed(
      `Your wallet is empty (${formatEuro(walletLeftNow())}). Top up to charge at ${
        stop.station._name
      } — about ${formatEuro(wanted * price)} is needed for the planned charge.`,
      "warn"
    );
    publish(true);
  }

  function beginCharging(stop) {
    const s = simRef.current;
    const st = stop.station;

    const powerAssumed = !(st._powerKw && st._powerKw > 0);
    const ratedKw = Math.min(powerAssumed ? ASSUMED_STATION_KW : st._powerKw, maxChargeKw);
    const wanted = Math.max(0, stop.chargeToKwh - s.kwh);
    const price = st._price !== null ? st._price : fallbackTariff > 0 ? fallbackTariff : null;

    if (wanted < 0.05) {
      pushFeed(`Battery already sufficient at ${st._name}. Not charging.`, "charge");
      s.charge = {
        key: st._key,
        name: st._name,
        total: 0,
        done: 0,
        minutes: 0,
        price,
        startKwh: s.kwh,
        ratedKw,
        currentKw: 0,
        final: !!stop.final,
        powerAssumed,
      };
      finishCharging();
      return;
    }

    // Charge only what the wallet can pay for.
    let total = wanted;
    let limited = false;

    if (price !== null && price > 0) {
      const affordable = Math.floor((walletLeftNow() / price) * 100) / 100;

      if (affordable < 0.05) {
        waitForTopup(stop, price, wanted);
        return;
      }

      if (affordable < wanted) {
        total = affordable;
        limited = true;
      }
    }

    const estMin = estimateChargeMinutes(s.kwh, s.kwh + total, ratedKw, capacity);

    s.charge = {
      key: st._key,
      name: st._name,
      startKwh: s.kwh,
      total,
      wanted,
      limited,
      done: 0,
      minutes: 0,
      ratedKw,
      currentKw: chargePowerNow(ratedKw, s.kwh / capacity),
      price,
      priceSource: st._price !== null ? "tariff" : price !== null ? "fallback" : "none",
      powerAssumed,
      estMinutes: estMin,
      final: !!stop.final,
    };
    s.mode = "charging";

    pushFeed(
      `Charging at ${st._name}: ${formatNumber(total, 1)} kWh, about ${formatMinutes(
        estMin
      )}. ${availabilityLabel(st)}.`,
      "charge"
    );

    if (limited) {
      pushFeed(
        `Your wallet only covers ${formatNumber(total, 1)} of the ${formatNumber(
          wanted,
          1
        )} kWh planned. Top up to charge more.`,
        "warn"
      );
    }
    if (price === null) {
      pushFeed("This station has no published tariff, so nothing will be billed for it.", "warn");
    }

    startLoop();

    // Live restaurants + Gemini suggestion while the car charges
    (async () => {
      const items = await loadRestaurants([st._lat, st._lng], st._name);
      askCompanion(
        `I'm charging at ${st._name} for about ${Math.round(
          estMin
        )} minutes. From the nearby restaurants list, suggest ONE place I can walk to and get back from before charging finishes, and say why in two sentences. If the list is empty, say so.`,
        { silentUser: true, restaurants: items, stopStation: st, chargeMin: estMin }
      );
    })();
  }

  // After a top-up, retry the charge that was waiting for money.
  resumeRef.current = () => {
    const s = simRef.current;
    if (s.mode !== "topup" || !s.stops[0]) return;
    s.mode = "checking";
    pushFeed("Wallet topped up. Resuming charging.", "charge");
    beginCharging(s.stops[0]);
  };

  function finishCharging() {
    const s = simRef.current;
    const c = s.charge;
    if (!c) return;

    const energy = round(c.done, 2);
    const cost = c.price !== null && c.price !== undefined ? round(energy * c.price, 2) : 0;

    if (energy > 0) {
      const session = {
        stationId: c.key,
        stationName: c.name,
        energyKwh: energy,
        pricePerKwh: c.price ?? null,
        costEur: cost,
        minutes: round(c.minutes, 0),
      };
      sessionsRef.current = [...sessionsRef.current, session];
      setSessions(sessionsRef.current);

      pushFeed(
        `Charging finished at ${c.name}: ${formatNumber(energy, 1)} kWh${
          c.price !== null && c.price !== undefined ? `, ${formatEuro(cost)}` : ", not billed (no tariff)"
        }. Battery ${Math.round((s.kwh / capacity) * 100)}%.`,
        "charge"
      );
      setRatePrompt({ stationId: c.key, name: c.name, done: false });
    }

    if (c.limited) {
      pushFeed(
        `Wallet limit reached: charged ${formatNumber(c.total, 1)} of ${formatNumber(
          c.wanted,
          1
        )} kWh planned at ${c.name}. Top up your wallet to charge more.`,
        "warn"
      );
    }

    s.stops.shift();

    // Charged less than planned: re-plan the rest of the trip from here.
    if (c.limited && !c.final) {
      const res = replanFromHere();
      if (res.stops.length || res.feasible) s.stops = res.stops;
    }

    setRemainingStops([...s.stops]);
    s.charge = null;

    if (c.final) {
      arriveDestination();
      return;
    }

    s.mode = "driving";
    pushFeed(
      s.stops[0]
        ? `Back on the road. Next: ${s.stops[0].station._name}.`
        : "Back on the road to the destination.",
      "drive"
    );
    startLoop();
  }

  function arriveDestination() {
    const s = simRef.current;
    s.running = false;
    s.mode = "arrived";
    s.km = route.total;
    publish(true);

    pushFeed(`Arrived at ${destinationLabel || "your destination"}.`, "drive");
    setPhase("DONE");
    loadRestaurants(pointAt(route, route.total).pos, destinationLabel || "Destination");
    saveTrip("arrived");
  }

  /* =========================================================
     SAVE (dashboard + wallet)
  ========================================================= */

  async function saveTrip(reason) {
    if (savingRef.current) return;
    if (!firebaseUid) {
      setSaveState({ status: "error", message: "No user account is linked to this session." });
      return;
    }

    savingRef.current = true;
    setSaveState({ status: "saving" });

    const s = simRef.current;
    const pos = route ? pointAt(route, s.km).pos : null;
    const pct = clamp((s.kwh / capacity) * 100, 0, 100);
    const rangeKm = Math.max(0, s.kwh / (consumption / 100));

    const payload = {
      tripId: tripIdRef.current,
      firebaseUid,
      status: reason,
      finalBattery: round(pct, 1),
      batteryKwh: round(s.kwh, 2),
      rangeKm: round(rangeKm, 0),
      latitude: pos?.[0] ?? null,
      longitude: pos?.[1] ?? null,
      destinationLabel: destinationLabel || null,
      distanceKm: round(s.km, 1),
      durationMin: round(s.elapsed, 0),
      sessions: sessionsRef.current,
    };

    try {
      const res = await fetchJson(`${api}/api/simulate/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const balance = safeNumber(res?.walletBalance);
      if (balance !== null) serverBalanceRef.current = balance;

      setSaveState({
        status: "saved",
        charged: safeNumber(res?.charged) ?? 0,
        shortfall: safeNumber(res?.shortfall) ?? 0,
        walletBalance: balance,
      });

      pushFeed(
        `Trip saved to your dashboard. ${
          (safeNumber(res?.charged) ?? 0) > 0
            ? `${formatEuro(res.charged)} deducted from your wallet.`
            : "No charging cost to deduct."
        }`,
        "charge"
      );

      onTripComplete?.({
        batteryPercent: payload.finalBattery,
        batteryKwh: payload.batteryKwh,
        rangeKm: payload.rangeKm,
        walletBalance: balance,
        latitude: payload.latitude,
        longitude: payload.longitude,
        label: destinationLabel || "Trip destination",
      });
    } catch (error) {
      setSaveState({
        status: "error",
        message: error?.message || "Could not save the trip.",
      });
    } finally {
      savingRef.current = false;
    }
  }

  /* =========================================================
     CONTROLS
  ========================================================= */

  function startRun() {
    if (!route || !plan) return;

    const s = simRef.current;
    s.km = 0;
    s.kwh = (capacity * startPct) / 100;
    s.elapsed = 0;
    s.stops = plan.stops.map((x) => ({ ...x }));
    s.charge = null;
    s.mode = "driving";
    s.lastNarrationKm = 0;
    s.lastRestKm = -999;
    s.lastRestAt = 0;
    s.lowWarned = false;
    s.near = new Set();
    s.look = new Set();
    s.walletWarn = new Set();

    excludedRef.current = new Set();
    sessionsRef.current = [];
    walletStartRef.current = walletBalance;
    serverBalanceRef.current = walletBalance;
    tripIdRef.current = newTripId();

    setSessions([]);
    setRemainingStops([...s.stops]);
    setSaveState({ status: "idle" });
    setRatePrompt(null);
    setPhase("RUN");
    setFollow(true);

    pushFeed(
      `Departing for ${destinationLabel}. ${formatKm(route.total)}, ${
        s.stops.length
      } charging stop${s.stops.length === 1 ? "" : "s"} planned.`,
      "drive"
    );

    publish(true);
    startLoop();
  }

  function togglePause() {
    const s = simRef.current;
    if (s.mode !== "driving" && s.mode !== "charging") return;
    if (s.running) {
      s.running = false;
      publish(true);
    } else {
      startLoop();
      publish(true);
    }
  }

  function stopAndSave() {
    const s = simRef.current;
    s.running = false;
    s.mode = "stopped";
    publish(true);
    setPhase("DONE");
    pushFeed("Trip stopped. Saving current position and battery.", "info");
    saveTrip("stopped");
  }

  function planOnward() {
    const s = simRef.current;
    const pos = route ? pointAt(route, s.km).pos : null;
    if (pos) setOrigin({ lat: pos[0], lng: pos[1] });

    setStartPct(clamp(round((s.kwh / capacity) * 100, 0), 1, 100));
    setTerminalStation(null);
    setRoute(null);
    setStations([]);
    setDestination(null);
    setDestinationQuery("");
    setDestinationLabel("");
    setRemainingStops([]);
    setSessions([]);
    setRatePrompt(null);
    setSaveState({ status: "idle" });

    sessionsRef.current = [];
    tripIdRef.current = newTripId();
    s.mode = "idle";
    s.km = 0;

    setPhase("PLAN");
    setFollow(false);
  }

  function requestClose() {
    const s = simRef.current;
    const unsaved =
      (phase === "RUN" || (phase === "DONE" && saveState.status !== "saved")) &&
      (s.km > 0 || sessionsRef.current.length > 0);

    if (
      unsaved &&
      !window.confirm(
        "This trip has not been saved. Battery and wallet will not be updated if you close now. Close anyway?"
      )
    ) {
      return;
    }
    onClose?.();
  }

  function openMapsToDestination() {
    if (!destination) return;
    if (typeof onOpenExternalMaps === "function") {
      onOpenExternalMaps({ latitude: destination.lat, longitude: destination.lng });
      return;
    }
    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}&travelmode=driving`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  async function rateStation(stars) {
    if (!ratePrompt || !firebaseUid) return;
    try {
      await fetchJson(
        `${api}/api/stations/${encodeURIComponent(ratePrompt.stationId)}/rating`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ firebaseUid, rating: stars }),
        }
      );
      setRatePrompt({ ...ratePrompt, done: true });
      pushFeed(`Thanks. Your ${stars}-star rating for ${ratePrompt.name} was saved.`, "info");
    } catch (error) {
      pushFeed(`Rating failed: ${error.message}`, "warn");
    }
  }

  /* =========================================================
     MAP DATA
  ========================================================= */

  const fitPoints = useMemo(() => {
    const pts = [];
    if (route) pts.push(...route.coords);
    if (origin) pts.push([origin.lat, origin.lng]);
    return pts;
  }, [route, origin]);

  const drivenLine = useMemo(() => {
    if (!route || !carState || !running) return null;
    return [...route.coords.slice(0, carState.idx + 1), carState.pos];
  }, [route, carState, running]);

  const aheadLine = useMemo(() => {
    if (!route) return null;
    if (!carState || !running) return route.coords;
    return [carState.pos, ...route.coords.slice(carState.idx + 1)];
  }, [route, carState, running]);

  const plannedKeys = useMemo(
    () => new Set(stopsForView.map((s) => s.station._key)),
    [stopsForView]
  );

  const mapCenter = origin ? [origin.lat, origin.lng] : [52.3676, 4.9041];

  const modeLabel = {
    idle: "Ready",
    driving: "Driving",
    checking: "Checking charger",
    charging: "Charging",
    blocked: "Waiting for a charger",
    topup: "Wallet empty — top up to continue",
    stranded: "Out of energy",
    arrived: "Arrived",
    stopped: "Stopped",
  }[snap.mode];

  /* =========================================================
     PARAMETER FORM (shared)
  ========================================================= */

  const locked = phase === "RUN";

  const paramsForm = (
    <div className="tc-input-grid">
      <label>
        <span>Battery capacity (kWh){assumed.capacity ? " · assumed" : ""}</span>
        <input
          type="number"
          min="1"
          disabled={locked}
          value={capacity}
          onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))}
        />
      </label>
      <label>
        <span>Start battery (%){assumed.battery ? " · assumed" : ""}</span>
        <input
          type="number"
          min="1"
          max="100"
          disabled={locked}
          value={startPct}
          onChange={(e) => setStartPct(clamp(Number(e.target.value) || 1, 1, 100))}
        />
      </label>
      <label>
        <span>Consumption (kWh/100 km){assumed.consumption ? " · assumed" : ""}</span>
        <input
          type="number"
          min="1"
          step="0.1"
          disabled={locked}
          value={consumption}
          onChange={(e) => setConsumption(Math.max(1, Number(e.target.value) || 1))}
        />
      </label>
      <label>
        <span>Reserve (%)</span>
        <input
          type="number"
          min="0"
          max="50"
          disabled={locked}
          value={reserve}
          onChange={(e) => setReserve(clamp(Number(e.target.value) || 0, 0, 50))}
        />
      </label>
      <label>
        <span>Charge up to (%)</span>
        <input
          type="number"
          min="20"
          max="100"
          disabled={locked}
          value={target}
          onChange={(e) => setTarget(clamp(Number(e.target.value) || 80, 20, 100))}
        />
      </label>
      <label>
        <span>Car max charge power (kW)</span>
        <input
          type="number"
          min="3"
          disabled={locked}
          value={maxChargeKw}
          onChange={(e) => setMaxChargeKw(Math.max(3, Number(e.target.value) || 3))}
        />
      </label>
      <label className="tc-wide">
        <span>Fallback tariff (€/kWh), only used if a station has no published price</span>
        <input
          type="number"
          min="0"
          step="0.01"
          disabled={locked}
          value={fallbackTariff}
          onChange={(e) => setFallbackTariff(Math.max(0, Number(e.target.value) || 0))}
        />
      </label>
    </div>
  );

  /* =========================================================
     RENDER
  ========================================================= */

  const charge = snap.charge;
  const chargeProgress =
    charge && charge.total > 0 ? clamp((charge.done / charge.total) * 100, 0, 100) : 0;

  const walletEmpty = walletShown <= WALLET_EMPTY_EUR;
  const needsTopupDone =
    saveState.status === "saved" &&
    ((saveState.shortfall || 0) > 0 || (saveState.walletBalance ?? 1) <= WALLET_EMPTY_EUR);

  return (
    <div className="tc-sim-backdrop">
      <style>{simulationCss}</style>

      <div className="tc-sim-panel">
        <div className="tc-sim-header">
          <div>
            <div className="tc-sim-eyebrow">⚡ TRUSTCHARGE LIVE TRIP</div>
            <h2>EV trip simulator</h2>
          </div>

          <div className="tc-header-right">
            <div className={`tc-wallet-pill ${walletEmpty ? "empty" : ""}`}>
              Wallet <strong>{formatEuro(walletShown)}</strong>
            </div>
            <div className="tc-live-pill">
              <span />
              LIVE DATA
            </div>
            <button type="button" onClick={requestClose} className="tc-sim-close">
              ✕
            </button>
          </div>
        </div>

        <div className="tc-sim-body">
          {/* ================= MAP ================= */}
          <div className="tc-map-col">
            <MapContainer
              center={mapCenter}
              zoom={10}
              scrollWheelZoom
              style={{ width: "100%", height: "100%" }}
            >
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              <MapFit points={fitPoints} fitKey={routeVersion} enabled={!follow} />
              <MapFollow
                lat={carPos?.[0]}
                lng={carPos?.[1]}
                follow={follow && phase === "RUN"}
              />

              {drivenLine && (
                <Polyline
                  positions={drivenLine}
                  pathOptions={{ color: "#94A3B8", weight: 5, opacity: 0.9 }}
                />
              )}

              {aheadLine && (
                <Polyline
                  positions={aheadLine}
                  pathOptions={{ color: "#F59E0B", weight: 5, opacity: 0.9 }}
                />
              )}

              {origin && (
                <Marker position={[origin.lat, origin.lng]} icon={startIcon}>
                  <Popup>Trip start</Popup>
                </Marker>
              )}

              {destination && (
                <Marker position={[destination.lat, destination.lng]} icon={destinationIcon}>
                  <Popup>
                    <strong>Destination</strong>
                    <br />
                    {destinationLabel}
                  </Popup>
                </Marker>
              )}

              {stations.map((st) => (
                <Marker
                  key={st._key}
                  position={[st._lat, st._lng]}
                  icon={stationMarkerIcon(isUsable(st), plannedKeys.has(st._key))}
                >
                  <Popup>
                    <div className="tc-popup">
                      <strong>{st._name}</strong>
                      <span>{availabilityLabel(st)}</span>
                      <span>
                        {st._powerKw ? `${formatNumber(st._powerKw, 0)} kW` : "Power unavailable"}
                      </span>
                      <span>{formatPrice(st._price)}</span>
                      {st._reliability !== null && (
                        <span>Reliability: {formatNumber(st._reliability, 0)}%</span>
                      )}
                      <span>{formatKm(st._routeKm)} into route</span>
                    </div>
                  </Popup>
                </Marker>
              ))}

              {stopsForView.map((stop, i) => (
                <CircleMarker
                  key={`stop-${stop.station._key}-${i}`}
                  center={[stop.station._lat, stop.station._lng]}
                  radius={12}
                  pathOptions={{
                    color: "#111827",
                    fillColor: "#FACC15",
                    fillOpacity: 0.95,
                    weight: 3,
                  }}
                >
                  <Popup>
                    <strong>Stop {i + 1}: {stop.station._name}</strong>
                    <br />
                    Arrive {formatNumber(stop.arrivalPct, 0)}% → {formatNumber(stop.chargeToPct, 0)}%
                    <br />
                    {formatNumber(stop.chargeKwh, 1)} kWh · {formatMinutes(stop.estMinutes)}
                  </Popup>
                </CircleMarker>
              ))}

              {showRestaurants &&
                rest.items.map((r) => (
                  <Marker
                    key={r.id}
                    position={[r.latitude, r.longitude]}
                    icon={restaurantIcon(selectedRestaurant?.id === r.id)}
                    eventHandlers={{ click: () => setSelectedRestaurant(r) }}
                  >
                    <Popup>
                      <div className="tc-popup">
                        <strong>{r.name}</strong>
                        <span>{r.cuisine || r.type || "Restaurant"}</span>
                        <span>
                          {formatNumber(r.distanceKm * 1000, 0)} m · {r.walkMin} min walk
                        </span>
                      </div>
                    </Popup>
                  </Marker>
                ))}

              {carPos && carState && (
                <Marker
                  position={carPos}
                  icon={carIcon(carState.heading)}
                  zIndexOffset={1000}
                >
                  <Popup>
                    <strong>Your car</strong>
                    <br />
                    Battery {formatNumber(batteryPct, 0)}%
                  </Popup>
                </Marker>
              )}
            </MapContainer>

            {route && (
              <div className="tc-hud">
                <div>
                  <small>BATTERY</small>
                  <strong>{formatNumber(batteryPct, 0)}%</strong>
                </div>
                <div>
                  <small>DRIVEN</small>
                  <strong>
                    {formatKm(running ? snap.km : 0)} / {formatKm(route.total)}
                  </strong>
                </div>
                <div>
                  <small>ETA</small>
                  <strong>{formatMinutes(etaMin)}</strong>
                </div>
                <div>
                  <small>{nextStop ? "NEXT CHARGER" : "DESTINATION"}</small>
                  <strong>
                    {formatKm(
                      nextStop
                        ? Math.max(0, nextStop.atKm - (running ? snap.km : 0))
                        : remainingKm
                    )}
                  </strong>
                </div>
              </div>
            )}

            {route && (
              <div className="tc-map-tools">
                <button type="button" className="tc-small-button" onClick={() => setFollow((f) => !f)}>
                  {follow ? "🗺 Overview" : "🎯 Follow car"}
                </button>
                <button
                  type="button"
                  className="tc-small-button"
                  onClick={() => setShowRestaurants((v) => !v)}
                >
                  🍴 {showRestaurants ? "Hide" : "Show"}
                </button>
              </div>
            )}

            {route && (
              <div className="tc-progress">
                <div
                  style={{
                    width: `${clamp(((running ? snap.km : 0) / route.total) * 100, 0, 100)}%`,
                  }}
                />
              </div>
            )}
          </div>

          {/* ================= SIDE ================= */}
          <div className="tc-side-col">
            {/* ---------- PLAN ---------- */}
            {phase === "PLAN" && (
              <div className="tc-card">
                <div className="tc-card-title">
                  <strong>Where to?</strong>
                  <span>Your car starts at its current position.</span>
                </div>

                <div className="tc-search-row">
                  <input
                    value={destinationQuery}
                    onChange={(e) => setDestinationQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitDestination()}
                    placeholder="e.g. Utrecht Centraal, Eindhoven, Groningen"
                  />
                  <button
                    type="button"
                    className="tc-primary-button"
                    disabled={planLoading || !destinationQuery.trim()}
                    onClick={submitDestination}
                  >
                    {planLoading ? "Planning…" : "Plan route"}
                  </button>
                </div>

                {geoResults.length > 0 && (
                  <div className="tc-geo-list">
                    {geoResults.map((r, i) => (
                      <button
                        key={`${r.lat}-${r.lng}-${i}`}
                        type="button"
                        onClick={() => planTripTo(r)}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                )}

                {planError && <div className="tc-error">{planError}</div>}
                {!origin && (
                  <div className="tc-error">Current vehicle location is unavailable.</div>
                )}

                {walletEmpty && (
                  <div style={{ marginTop: 10 }}>
                    {renderTopup(
                      "Your wallet is empty",
                      "Charging is billed from your wallet. Top up before you start."
                    )}
                  </div>
                )}

                <details className="tc-details" open>
                  <summary>Vehicle model</summary>
                  {paramsForm}
                  <div className="tc-hint">
                    Values marked “assumed” were not available from live telemetry.
                  </div>
                </details>
              </div>
            )}

            {/* ---------- READY ---------- */}
            {phase === "READY" && route && (
              <div className="tc-card">
                <div className="tc-card-title">
                  <strong>{destinationLabel}</strong>
                  <span>
                    {formatKm(route.total)} · {formatMinutes(routeDurationMin)} driving
                  </span>
                </div>

                {planLoading || stationsLoading ? (
                  <div className="tc-note">Loading live stations along the route…</div>
                ) : (
                  <>
                    {plan && !plan.feasible && (
                      <div className="tc-error">
                        With this battery and the live stations found, the destination
                        cannot be reached above your reserve. Raise the start battery or
                        lower the reserve.
                      </div>
                    )}

                    {plan?.stops.length === 0 && plan.feasible && (
                      <div className="tc-ok">
                        You can reach the destination without charging.
                      </div>
                    )}

                    {plan?.stops.map((stop, i) => (
                      <div className="tc-stop-row" key={`${stop.station._key}-${i}`}>
                        <div className="tc-stop-number">{i + 1}</div>
                        <div className="tc-stop-main">
                          <strong>{stop.station._name}</strong>
                          <span>
                            {formatKm(stop.atKm)} into route · {availabilityLabel(stop.station)}
                          </span>
                        </div>
                        <div className="tc-stop-data">
                          <span>
                            {formatNumber(stop.arrivalPct, 0)}% → {formatNumber(stop.chargeToPct, 0)}%
                          </span>
                          <span>{formatNumber(stop.chargeKwh, 1)} kWh</span>
                          <span>
                            {formatMinutes(stop.estMinutes)}
                            {stop.powerAssumed ? " (power assumed)" : ""}
                          </span>
                          <span>
                            {stop.estCost !== null ? formatEuro(stop.estCost) : "No tariff"}
                          </span>
                        </div>
                      </div>
                    ))}

                    <div className="tc-summary-grid">
                      <div>
                        <small>EST. CHARGING COST</small>
                        <strong>
                          {formatEuro(planCost.total)}
                          {planCost.unpriced > 0 ? ` (+${planCost.unpriced} unpriced)` : ""}
                        </strong>
                      </div>
                      <div>
                        <small>WALLET</small>
                        <strong>{formatEuro(walletBalance)}</strong>
                      </div>
                      <div>
                        <small>EST. ARRIVAL</small>
                        <strong>{formatMinutes(etaMin)}</strong>
                      </div>
                    </div>

                    {planCost.total > walletBalance + 0.005 &&
                      renderTopup(
                        walletBalance <= WALLET_EMPTY_EUR
                          ? "Your wallet is empty — top up to charge"
                          : "Your wallet may not cover this trip",
                        `Estimated charging cost ${formatEuro(planCost.total)}, wallet ${formatEuro(
                          walletBalance
                        )}. Charging will stop when the wallet runs out.`
                      )}

                    {stationsNote && <div className="tc-note">{stationsNote}</div>}
                  </>
                )}

                <div className="tc-live-source">
                  ● LIVE NETWORK DATA
                  <span>
                    Refreshed{" "}
                    {lastRefresh
                      ? lastRefresh.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </span>
                </div>

                <div className="tc-button-row">
                  <button
                    type="button"
                    className="tc-primary-button tc-large-button"
                    disabled={stationsLoading || planLoading || !plan}
                    onClick={startRun}
                  >
                    ▶ Start live drive
                  </button>
                  <button
                    type="button"
                    className="tc-secondary-button"
                    disabled={stationsLoading}
                    onClick={refreshStations}
                  >
                    ↻ Refresh stations
                  </button>
                  <button type="button" className="tc-small-button" onClick={openMapsToDestination}>
                    Open in Maps
                  </button>
                  <button
                    type="button"
                    className="tc-small-button"
                    onClick={() => {
                      setRoute(null);
                      setStations([]);
                      setPhase("PLAN");
                    }}
                  >
                    Change destination
                  </button>
                </div>

                <details className="tc-details">
                  <summary>Vehicle model</summary>
                  {paramsForm}
                </details>
              </div>
            )}

            {/* ---------- RUN ---------- */}
            {phase === "RUN" && (
              <div className="tc-card">
                <div className="tc-card-title">
                  <strong>{modeLabel}</strong>
                  <span>
                    {formatMinutes(snap.elapsed)} elapsed · {formatNumber(avgSpeed, 0)} km/h avg
                  </span>
                </div>

                {charge && charge.total > 0 && (
                  <div className="tc-charge-box">
                    <div className="tc-charge-top">
                      <strong>{charge.name}</strong>
                      <span>
                        {formatNumber(charge.currentKw, 0)} kW
                        {charge.powerAssumed ? " (assumed)" : ""}
                      </span>
                    </div>
                    <div className="tc-progress tc-progress-inline">
                      <div style={{ width: `${chargeProgress}%` }} />
                    </div>
                    <div className="tc-summary-grid">
                      <div>
                        <small>ENERGY</small>
                        <strong>
                          {formatNumber(charge.done, 1)} / {formatNumber(charge.total, 1)} kWh
                        </strong>
                      </div>
                      <div>
                        <small>PRICE</small>
                        <strong>{formatPrice(charge.price)}</strong>
                      </div>
                      <div>
                        <small>COST SO FAR</small>
                        <strong>
                          {charge.price !== null && charge.price !== undefined
                            ? formatEuro(charge.done * charge.price)
                            : "Not billed"}
                        </strong>
                      </div>
                    </div>
                    {charge.limited && (
                      <div className="tc-hint">
                        Limited by wallet: {formatNumber(charge.total, 1)} of{" "}
                        {formatNumber(charge.wanted, 1)} kWh planned.
                      </div>
                    )}
                  </div>
                )}

                {snap.mode === "blocked" && (
                  <div className="tc-warning">
                    The charger is unavailable and nothing else is in range. Re-checking
                    automatically.
                    <button type="button" className="tc-small-button" onClick={recheckBlocked}>
                      Re-check now
                    </button>
                  </div>
                )}

                {snap.mode === "stranded" && (
                  <div className="tc-error">
                    The battery ran out before the next charger. Stop here to save the trip.
                  </div>
                )}

                {(snap.mode === "topup" || walletEmpty) &&
                  renderTopup(
                    snap.mode === "topup"
                      ? "Wallet empty — top up to continue charging"
                      : "Your wallet is empty",
                    snap.mode === "topup"
                      ? "The trip is paused. Charging resumes automatically once your payment is confirmed."
                      : "The next charge cannot be paid until you top up."
                  )}

                <div className="tc-summary-grid">
                  <div>
                    <small>BATTERY</small>
                    <strong>{formatNumber(batteryPct, 0)}%</strong>
                  </div>
                  <div>
                    <small>CHARGING COST</small>
                    <strong>{formatEuro(runningCost)}</strong>
                  </div>
                  <div>
                    <small>WALLET AFTER</small>
                    <strong>{formatEuro(walletShown)}</strong>
                  </div>
                </div>

                <div className="tc-button-row">
                  {(snap.mode === "driving" || snap.mode === "charging") && (
                    <button type="button" className="tc-secondary-button" onClick={togglePause}>
                      {snap.running ? "⏸ Pause" : "▶ Resume"}
                    </button>
                  )}
                  <label className="tc-speed">
                    Speed
                    <select
                      value={timeScale}
                      onChange={(e) => setTimeScale(Number(e.target.value))}
                    >
                      {[1, 5, 10, 30, 60, 120, 300].map((v) => (
                        <option key={v} value={v}>
                          {v}×
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="tc-small-button" onClick={stopAndSave}>
                    Stop here &amp; save
                  </button>
                </div>

                {remainingStops.length > 0 && (
                  <div className="tc-upcoming">
                    <small>UPCOMING STOPS</small>
                    {remainingStops.map((stop, i) => (
                      <div key={`${stop.station._key}-${i}`}>
                        {i + 1}. {stop.station._name} · {formatKm(stop.atKm)} ·{" "}
                        {formatNumber(stop.chargeKwh, 1)} kWh
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ---------- DONE ---------- */}
            {phase === "DONE" && (
              <div className="tc-card tc-done">
                <div className="tc-card-title">
                  <strong>
                    {snap.mode === "arrived" ? "✓ Arrived" : "Trip stopped"}
                  </strong>
                  <span>{destinationLabel}</span>
                </div>

                <div className="tc-summary-grid">
                  <div>
                    <small>DISTANCE</small>
                    <strong>{formatKm(snap.km)}</strong>
                  </div>
                  <div>
                    <small>TRIP TIME</small>
                    <strong>{formatMinutes(snap.elapsed)}</strong>
                  </div>
                  <div>
                    <small>BATTERY</small>
                    <strong>{formatNumber(batteryPct, 0)}%</strong>
                  </div>
                </div>

                {sessions.length > 0 && (
                  <div className="tc-upcoming">
                    <small>CHARGING SESSIONS</small>
                    {sessions.map((s, i) => (
                      <div key={`${s.stationId}-${i}`}>
                        {s.stationName}: {formatNumber(s.energyKwh, 1)} kWh ·{" "}
                        {s.pricePerKwh !== null ? formatEuro(s.costEur) : "not billed"}
                      </div>
                    ))}
                  </div>
                )}

                {saveState.status === "saving" && (
                  <div className="tc-note">Saving to your dashboard…</div>
                )}

                {saveState.status === "saved" && (
                  <div className="tc-ok">
                    Saved to your dashboard. {formatEuro(saveState.charged)} deducted from
                    your wallet
                    {saveState.walletBalance !== null
                      ? `; new balance ${formatEuro(saveState.walletBalance)}`
                      : ""}
                    .
                    {saveState.shortfall > 0 && (
                      <>
                        {" "}
                        Your balance did not cover the full cost; {formatEuro(saveState.shortfall)}{" "}
                        was not collected.
                      </>
                    )}
                  </div>
                )}

                {needsTopupDone &&
                  renderTopup(
                    "Your wallet is empty — top up",
                    "Add credit so your next trip can charge without interruption."
                  )}

                {saveState.status === "error" && (
                  <div className="tc-error">
                    {saveState.message}
                    <button
                      type="button"
                      className="tc-small-button"
                      onClick={() => saveTrip(snap.mode === "arrived" ? "arrived" : "stopped")}
                    >
                      Retry save
                    </button>
                  </div>
                )}

                <div className="tc-button-row">
                  <button
                    type="button"
                    className="tc-primary-button"
                    disabled={saveState.status !== "saved"}
                    onClick={planOnward}
                  >
                    Plan next leg from here
                  </button>
                  <button type="button" className="tc-secondary-button" onClick={onClose}>
                    Back to dashboard
                  </button>
                </div>
              </div>
            )}

            {/* ---------- RATE ---------- */}
            {ratePrompt && !ratePrompt.done && (
              <div className="tc-card">
                <div className="tc-card-title">
                  <strong>How was {ratePrompt.name}?</strong>
                  <span>Your rating feeds the station’s reliability score.</span>
                </div>
                <StarsInput onRate={rateStation} disabled={!firebaseUid} />
              </div>
            )}

            {/* ---------- COMPANION ---------- */}
            <div className="tc-card">
              <div className="tc-card-title">
                <strong>Companion</strong>
                <span>Live trip log and Gemini assistant</span>
              </div>

              <div className="tc-rest-box">
                <div className="tc-rest-head">
                  <strong>🍴 Nearby restaurants</strong>
                  <button
                    type="button"
                    className="tc-small-button"
                    disabled={rest.loading || !currentPos()}
                    onClick={() => loadRestaurants(currentPos(), "Near your position")}
                  >
                    {rest.loading ? "Loading…" : "↻ Near car"}
                  </button>
                </div>
                {rest.label && <small className="tc-hint">Around: {rest.label}</small>}
                {rest.error && (
                  <div className="tc-error">
                    {rest.error}
                    <button
                      type="button"
                      className="tc-small-button"
                      onClick={() => loadRestaurants(currentPos(), rest.label || "Near your position")}
                    >
                      Retry
                    </button>
                  </div>
                )}
                {!rest.loading && !rest.error && rest.items.length === 0 && (
                  <div className="tc-note">
                    {rest.label
                      ? `No named restaurants within ${
                          rest.radius >= 1000 ? `${rest.radius / 1000} km` : `${rest.radius} m`
                        }.`
                      : "Restaurants load automatically while you drive and charge."}
                  </div>
                )}
                <div className="tc-rest-list">
                  {rest.items.slice(0, 6).map((r) => (
                    <button
                      type="button"
                      key={r.id}
                      className={selectedRestaurant?.id === r.id ? "selected" : ""}
                      onClick={() => setSelectedRestaurant(r)}
                    >
                      <strong>{r.name}</strong>
                      <span>
                        {r.cuisine || r.type || "Restaurant"} · {formatNumber(r.distanceKm * 1000, 0)} m ·{" "}
                        {r.walkMin} min walk
                      </span>
                    </button>
                  ))}
                </div>
                {selectedRestaurant && (
                  <a
                    className="tc-link"
                    target="_blank"
                    rel="noopener noreferrer"
                    href={`https://www.google.com/maps/search/?api=1&query=${selectedRestaurant.latitude},${selectedRestaurant.longitude}`}
                  >
                    Open {selectedRestaurant.name} in Maps
                  </a>
                )}
              </div>

              <div className="tc-chips">
                {["Where should I eat?", "Do I need to charge soon?", "Which station is most reliable ahead?"].map(
                  (q) => (
                    <button
                      key={q}
                      type="button"
                      className="tc-small-button"
                      disabled={aiLoading}
                      onClick={() => askCompanion(q)}
                    >
                      {q}
                    </button>
                  )
                )}
              </div>

              <form className="tc-chat-form" onSubmit={submitChat}>
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask your companion…"
                  disabled={aiLoading}
                />
                <button
                  type="submit"
                  className="tc-primary-button"
                  disabled={aiLoading || !chatInput.trim()}
                >
                  {aiLoading ? "…" : "Send"}
                </button>
              </form>

              <div className="tc-feed">
                {feed.length === 0 && (
                  <div className="tc-note">Trip events and assistant replies will appear here.</div>
                )}
                {feed.map((item) => (
                  <div key={item.id} className={`tc-feed-item ${item.type}`}>
                    <small>
                      {item.type === "ai" ? "GEMINI" : item.type === "you" ? "YOU" : "TRIP"} ·{" "}
                      {item.clock}
                    </small>
                    <div>{item.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   CSS
========================================================= */

const simulationCss = `
  .tc-sim-backdrop {
    position: fixed; inset: 0; z-index: 4000;
    background: rgba(9,12,22,.78); backdrop-filter: blur(7px);
    display: flex; align-items: center; justify-content: center; padding: 14px;
  }
  .tc-sim-panel {
    width: min(1320px,100%); height: min(94vh,920px);
    display: flex; flex-direction: column;
    background: #f8fafc; border-radius: 22px; color: #111827;
    box-shadow: 0 30px 90px rgba(0,0,0,.45); overflow: hidden;
  }
  .tc-sim-header {
    display: flex; align-items: center; justify-content: space-between; gap: 14px;
    padding: 14px 18px; background: #090d16; color: #fff;
  }
  .tc-sim-header h2 { margin: 2px 0 0; font-size: 20px; font-weight: 900; letter-spacing: -.02em; }
  .tc-sim-eyebrow { color: #fbbf24; font-size: 10px; font-weight: 900; letter-spacing: .09em; }
  .tc-header-right { display: flex; align-items: center; gap: 10px; }
  .tc-wallet-pill {
    padding: 7px 11px; border-radius: 999px; background: rgba(250,204,21,.14);
    color: #fde68a; font-size: 11px; font-weight: 700;
  }
  .tc-wallet-pill strong { color: #fff; margin-left: 4px; }
  .tc-wallet-pill.empty { background: rgba(239,68,68,.2); color: #fecaca; }
  .tc-live-pill {
    display: flex; align-items: center; gap: 7px; padding: 7px 10px; border-radius: 999px;
    background: rgba(16,185,129,.14); color: #34d399; font-size: 10px; font-weight: 900; white-space: nowrap;
  }
  .tc-live-pill span { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 4px rgba(34,197,94,.15); }
  .tc-sim-close {
    width: 34px; height: 34px; border-radius: 50%; border: 1px solid #334155;
    background: transparent; color: #e2e8f0; cursor: pointer; font-weight: 900;
  }
  .tc-sim-close:hover { background: #1e293b; }

  .tc-sim-body {
    flex: 1; min-height: 0; display: grid;
    grid-template-columns: minmax(0,1.5fr) minmax(340px,1fr);
    gap: 12px; padding: 12px;
  }
  .tc-map-col {
    position: relative; min-height: 340px; border-radius: 16px; overflow: hidden;
    border: 1px solid #cbd5e1; background: #e2e8f0;
  }
  .tc-side-col { overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 2px; }

  .tc-hud {
    position: absolute; top: 10px; left: 10px; right: 10px; z-index: 1000;
    display: grid; grid-template-columns: repeat(4,1fr); gap: 6px; pointer-events: none;
  }
  .tc-hud > div {
    background: rgba(9,13,22,.88); color: #fff; border-radius: 10px; padding: 7px 9px; min-width: 0;
  }
  .tc-hud small { display: block; color: #94a3b8; font-size: 8px; font-weight: 800; letter-spacing: .07em; }
  .tc-hud strong { display: block; margin-top: 2px; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tc-map-tools { position: absolute; left: 10px; bottom: 26px; z-index: 1000; display: flex; gap: 6px; }
  .tc-progress { height: 9px; border-radius: 999px; background: #e2e8f0; overflow: hidden; }
  .tc-map-col > .tc-progress { position: absolute; left: 10px; right: 10px; bottom: 10px; z-index: 1000; }
  .tc-progress > div { height: 100%; background: #f59e0b; border-radius: inherit; transition: width .1s linear; }
  .tc-progress-inline { margin: 8px 0; }

  .tc-card {
    border: 1px solid #e2e8f0; border-radius: 14px; background: #fff; padding: 13px;
  }
  .tc-done { border-color: #bbf7d0; background: #f0fdf4; }
  .tc-card-title { margin-bottom: 10px; }
  .tc-card-title strong { display: block; font-size: 14px; font-weight: 900; }
  .tc-card-title span { display: block; margin-top: 3px; color: #64748b; font-size: 11px; }

  .tc-search-row { display: flex; gap: 8px; }
  .tc-search-row input, .tc-chat-form input, .tc-input-grid input {
    width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 9px;
    padding: 10px 11px; font-size: 12px; color: #111827; background: #fff; outline: none;
  }
  .tc-search-row input, .tc-chat-form input { flex: 1; min-width: 0; }
  .tc-search-row input:focus, .tc-chat-form input:focus, .tc-input-grid input:focus {
    border-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.14);
  }
  .tc-input-grid input:disabled { background: #f1f5f9; color: #94a3b8; }

  .tc-geo-list { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
  .tc-geo-list button {
    text-align: left; border: 1px solid #e2e8f0; background: #fff; border-radius: 9px;
    padding: 9px 10px; font-size: 11px; cursor: pointer; color: #334155;
  }
  .tc-geo-list button:hover { border-color: #f59e0b; }

  .tc-details { margin-top: 12px; }
  .tc-details summary { cursor: pointer; font-size: 12px; font-weight: 800; color: #334155; margin-bottom: 8px; }
  .tc-input-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 9px; }
  .tc-input-grid label { display: flex; flex-direction: column; gap: 4px; }
  .tc-input-grid label span { color: #64748b; font-size: 10px; font-weight: 700; }
  .tc-input-grid .tc-wide { grid-column: 1 / -1; }
  .tc-hint { color: #94a3b8; font-size: 10px; margin-top: 6px; display: block; }

  .tc-primary-button, .tc-secondary-button, .tc-small-button {
    border: none; cursor: pointer; border-radius: 9px; font-size: 11px; font-weight: 900;
    padding: 10px 13px; white-space: nowrap;
  }
  .tc-primary-button { background: #facc15; color: #111827; }
  .tc-primary-button:hover:not(:disabled) { background: #f59e0b; }
  .tc-secondary-button { background: #111827; color: #fff; }
  .tc-secondary-button:hover:not(:disabled) { background: #1f2937; }
  .tc-small-button { background: #f8fafc; border: 1px solid #cbd5e1; color: #475569; padding: 8px 10px; }
  .tc-small-button:hover:not(:disabled) { background: #f1f5f9; }
  .tc-primary-button:disabled, .tc-secondary-button:disabled, .tc-small-button:disabled { opacity: .5; cursor: not-allowed; }
  .tc-large-button { padding: 12px 17px; font-size: 12px; }
  .tc-button-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; }
  .tc-speed { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #64748b; font-weight: 700; }
  .tc-speed select { border: 1px solid #cbd5e1; border-radius: 7px; padding: 6px; font-size: 11px; }

  .tc-error, .tc-warning, .tc-ok, .tc-note {
    margin-top: 9px; padding: 9px 10px; border-radius: 9px; font-size: 11px; line-height: 1.45;
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px; justify-content: space-between;
  }
  .tc-error { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; }
  .tc-warning { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
  .tc-ok { background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; display: block; }
  .tc-note { background: #f8fafc; border: 1px solid #e2e8f0; color: #64748b; display: block; }

  .tc-topup {
    margin-top: 10px; padding: 11px; border-radius: 11px;
    background: #fffbeb; border: 1px solid #fcd34d;
    display: flex; flex-direction: column; gap: 8px;
  }
  .tc-topup > strong { font-size: 12px; color: #92400e; }
  .tc-topup > span { font-size: 11px; color: #92400e; line-height: 1.45; }
  .tc-topup-amounts { display: flex; gap: 6px; flex-wrap: wrap; }
  .tc-topup-amounts button {
    border: 1px solid #fcd34d; background: #fff; color: #92400e; border-radius: 8px;
    padding: 7px 12px; font-size: 11px; font-weight: 900; cursor: pointer;
  }
  .tc-topup-amounts button.on { background: #111827; border-color: #111827; color: #fff; }
  .tc-topup-amounts button:disabled { opacity: .5; cursor: not-allowed; }
  .tc-topup-msg { font-size: 11px; color: #166534; line-height: 1.45; }
  .tc-topup-msg.err { color: #b91c1c; }
  .tc-topup-links { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .tc-topup-links a { font-size: 11px; font-weight: 800; color: #b45309; }

  .tc-stop-row {
    display: flex; align-items: center; gap: 10px; border: 1px solid #fde68a; background: #fffbeb;
    border-radius: 10px; padding: 9px; margin-top: 7px; flex-wrap: wrap;
  }
  .tc-stop-number {
    width: 26px; height: 26px; flex: 0 0 26px; border-radius: 50%; background: #facc15;
    display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 11px;
  }
  .tc-stop-main { flex: 1; min-width: 140px; }
  .tc-stop-main strong { display: block; font-size: 12px; }
  .tc-stop-main span { display: block; color: #64748b; font-size: 10px; margin-top: 2px; }
  .tc-stop-data { display: flex; flex-wrap: wrap; gap: 5px; }
  .tc-stop-data span {
    background: #fff; border-radius: 7px; padding: 4px 7px; color: #475569; font-size: 10px; font-weight: 700;
  }

  .tc-summary-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 7px; margin-top: 10px; }
  .tc-summary-grid > div { background: #f8fafc; border: 1px solid #edf2f7; border-radius: 10px; padding: 8px; min-width: 0; }
  .tc-done .tc-summary-grid > div { background: #fff; }
  .tc-summary-grid small { display: block; color: #94a3b8; font-size: 8px; font-weight: 800; letter-spacing: .06em; }
  .tc-summary-grid strong { display: block; margin-top: 3px; font-size: 12px; }

  .tc-charge-box { border: 1px solid #bbf7d0; background: #f0fdf4; border-radius: 12px; padding: 10px; margin-bottom: 10px; }
  .tc-charge-top { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
  .tc-charge-top span { color: #15803d; font-weight: 800; }
  .tc-upcoming { margin-top: 10px; font-size: 11px; color: #475569; display: flex; flex-direction: column; gap: 3px; }
  .tc-upcoming small { color: #94a3b8; font-size: 8px; font-weight: 800; letter-spacing: .06em; }

  .tc-live-source {
    display: flex; justify-content: space-between; gap: 8px; margin-top: 10px; padding: 7px 9px;
    border-radius: 8px; background: #f0fdf4; border: 1px solid #dcfce7; color: #15803d; font-size: 9px; font-weight: 900;
  }
  .tc-live-source span { color: #64748b; font-weight: 700; }

  .tc-rest-box { border: 1px solid #e2e8f0; border-radius: 11px; padding: 10px; background: #f8fafc; }
  .tc-rest-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; }
  .tc-rest-list { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
  .tc-rest-list button {
    text-align: left; border: 1px solid #e2e8f0; background: #fff; border-radius: 9px; padding: 8px 9px; cursor: pointer;
  }
  .tc-rest-list button.selected { border-color: #f59e0b; background: #fffbeb; }
  .tc-rest-list strong { display: block; font-size: 12px; }
  .tc-rest-list span { display: block; margin-top: 2px; font-size: 10px; color: #64748b; }
  .tc-link { display: inline-block; margin-top: 8px; font-size: 11px; font-weight: 800; color: #b45309; }

  .tc-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .tc-chat-form { display: flex; gap: 7px; margin-top: 10px; }
  .tc-feed { margin-top: 10px; max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
  .tc-feed-item { border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px 9px; font-size: 11px; line-height: 1.5; color: #334155; background: #fff; }
  .tc-feed-item small { display: block; font-size: 8px; font-weight: 900; letter-spacing: .07em; color: #94a3b8; margin-bottom: 3px; }
  .tc-feed-item.ai { background: #fffbeb; border-color: #fde68a; }
  .tc-feed-item.you { background: #111827; border-color: #111827; color: #fff; }
  .tc-feed-item.warn { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
  .tc-feed-item.charge { background: #f0fdf4; border-color: #bbf7d0; color: #166534; }

  .tc-stars { display: flex; gap: 4px; }
  .tc-stars button { border: none; background: none; font-size: 26px; color: #cbd5e1; cursor: pointer; padding: 0 2px; }
  .tc-stars button.on { color: #f59e0b; }

  .tc-popup { display: flex; flex-direction: column; gap: 3px; min-width: 160px; font-size: 11px; }
  .tc-popup strong { font-size: 12px; }

  @media (max-width: 900px) {
    .tc-sim-backdrop { padding: 0; align-items: stretch; }
    .tc-sim-panel { height: 100dvh; border-radius: 0; }
    .tc-sim-body { display: flex; flex-direction: column; overflow-y: auto; }
    .tc-map-col { flex: 0 0 auto; height: 360px; min-height: 360px; }
    .tc-side-col { overflow: visible; }
    .tc-hud { grid-template-columns: repeat(2,1fr); }
    .tc-wallet-pill { display: none; }
  }
  @media (max-width: 520px) {
    .tc-input-grid { grid-template-columns: 1fr; }
    .tc-search-row { flex-direction: column; }
    .tc-summary-grid { grid-template-columns: 1fr 1fr; }
  }
`;
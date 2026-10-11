import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";

import L from "leaflet";
import "leaflet/dist/leaflet.css";

import Simulation from "./Simulation";
import Reservation from "./Reservation";
import PaymentIntegration from "./PaymentIntegration";

/* =========================================================
   CONFIG
========================================================= */

const DEFAULT_API_BASE_URL =
  import.meta.env?.VITE_API_BASE_URL || "http://localhost:5000";

const REFRESH_SECONDS = 60;
const TELEMETRY_REFRESH_SECONDS = 30;

const TOPUP_AMOUNTS = [5, 10, 25, 50];
const WALLET_EMPTY_EUR = 0.005;
const WALLET_LOW_EUR = 2;

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: "▦" },
  { id: "reserve", label: "Reserve a Port", icon: "🎟" },
  { id: "payment", label: "Membership & Payment", icon: "💳" },
];

const PLAN_LABELS = {
  STANDARD: "STANDARD",
  PLUS: "PLUS",
  PRO: "PRO PRIORITY",
};

const NL_REGIONS = [
  { id: "amsterdam", name: "Amsterdam", lat: 52.3676, lon: 4.9041 },
  { id: "utrecht", name: "Utrecht", lat: 52.0907, lon: 5.1214 },
  { id: "rotterdam", name: "Rotterdam", lat: 51.9244, lon: 4.4777 },
  { id: "the_hague", name: "The Hague", lat: 52.0705, lon: 4.3007 },
  { id: "eindhoven", name: "Eindhoven", lat: 51.4416, lon: 5.4697 },
];

/* =========================================================
   MAP ICONS
========================================================= */

const userIcon = L.divIcon({
  className: "trustcharge-user-marker",
  html: `
    <div style="width:48px;height:48px;border-radius:50%;background:#111827;border:3px solid #FACC15;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 6px rgba(250,204,21,.16),0 8px 22px rgba(0,0,0,.28);font-size:22px;">⚡</div>
  `,
  iconSize: [48, 48],
  iconAnchor: [24, 24],
});

function stationIcon(status) {
  let bg = "#64748B";
  let glow = "rgba(100,116,139,.45)";

  if (status === "AVAILABLE") {
    bg = "#10B981";
    glow = "rgba(16,185,129,.55)";
  }
  if (status === "OCCUPIED") {
    bg = "#F59E0B";
    glow = "rgba(245,158,11,.55)";
  }
  if (status === "OUT_OF_SERVICE") {
    bg = "#EF4444";
    glow = "rgba(239,68,68,.55)";
  }

  return L.divIcon({
    className: "trustcharge-station-icon",
    html: `
      <div style="width:38px;height:38px;border-radius:50%;background:${bg};border:3px solid #FFFFFF;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 5px ${glow},0 7px 18px rgba(0,0,0,.25);font-size:17px;">⚡</div>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

/* =========================================================
   MAP CONTROLLER
========================================================= */

function MapController({ center, zoom }) {
  const map = useMap();

  useEffect(() => {
    if (!center) return;
    map.flyTo(center, zoom || 13, { animate: true, duration: 1 });
  }, [center, zoom, map]);

  return null;
}

/* =========================================================
   SAFE DATA HELPERS
========================================================= */

function safeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getVehicleName(vehicle) {
  if (!vehicle) return "No RDW vehicle registered";
  return (
    vehicle.name ||
    vehicle.model ||
    vehicle.handelsbenaming ||
    vehicle.merk ||
    "Verified vehicle"
  );
}

function getPlate(vehicle) {
  if (!vehicle) return null;
  return vehicle.plate || vehicle.kenteken || vehicle.registration || null;
}

/* =========================================================
   STATION STATUS
========================================================= */

function getStationStatus(station) {
  const explicit = String(station?.status || "").trim().toUpperCase();

  if (["AVAILABLE", "OCCUPIED", "OUT_OF_SERVICE", "UNKNOWN"].includes(explicit)) {
    return explicit;
  }

  if (station?.available === true) return "AVAILABLE";
  if (station?.available === false) return "OCCUPIED";

  const available = safeNumber(station?.availablePorts ?? station?.available);
  const total = safeNumber(station?.totalPorts ?? station?.total);

  if (available !== null && total !== null && total > 0) {
    if (available > 0) return "AVAILABLE";
    if (available === 0) return "OCCUPIED";
  }

  return "UNKNOWN";
}

function statusLabel(status) {
  switch (status) {
    case "AVAILABLE":
      return "AVAILABLE";
    case "OCCUPIED":
      return "OCCUPIED";
    case "OUT_OF_SERVICE":
      return "OUT OF SERVICE";
    default:
      return "STATUS UNKNOWN";
  }
}

function statusColor(status) {
  switch (status) {
    case "AVAILABLE":
      return "#10B981";
    case "OCCUPIED":
      return "#F59E0B";
    case "OUT_OF_SERVICE":
      return "#EF4444";
    default:
      return "#64748B";
  }
}

/* =========================================================
   FORMATTERS
========================================================= */

function formatPrice(station) {
  const rawPrice = station?.pricePerKwh;

  if (rawPrice === null || rawPrice === undefined || rawPrice === "") {
    if (typeof station?.priceLabel === "string" && station.priceLabel.trim()) {
      return station.priceLabel;
    }
    return "—";
  }

  const numeric = safeNumber(rawPrice);
  if (numeric === null) return "—";

  let unit = "kWh";
  if (typeof station?.priceUnit === "string" && station.priceUnit.trim()) {
    unit = station.priceUnit.replace(/^€\/?/, "").trim() || "kWh";
  }

  return `€${numeric.toFixed(3)} / ${unit}`;
}

function formatPower(station) {
  const value = safeNumber(
    station?.powerKw ?? station?.maxPowerKw ?? station?.power
  );
  return value === null ? "Power unavailable" : `${value} kW`;
}

function formatDistance(station) {
  const value = safeNumber(station?.distanceKm);
  return value === null ? "Distance unavailable" : `${value.toFixed(1)} km`;
}

function reliabilitySourcesText(station) {
  const sources = station?.reliabilitySources;
  if (!sources || typeof sources !== "object") return null;

  const entries = Object.entries(sources);
  if (!entries.length) return null;

  return entries.map(([source, count]) => `${source} (${count})`).join(" • ");
}

/* =========================================================
   RELIABILITY (STARS)
   A station with too few live observations reports
   reliability === null. That case is preserved, so "not
   enough data yet" is never shown as good or bad.
========================================================= */

function reliabilityToStars(station) {
  const value = safeNumber(station?.reliability);
  if (value === null) return null;

  const raw = (value / 100) * 5;
  const rounded = Math.round(raw * 2) / 2;
  return Math.min(5, Math.max(0, rounded));
}

function reliabilityObservationCount(station) {
  return safeNumber(
    station?.reliabilityObservations ??
      station?.observationCount ??
      station?.reliabilityObservationCount
  );
}

function StarRating({ station, size = 13, showLabel = true }) {
  const stars = reliabilityToStars(station);
  const observations = reliabilityObservationCount(station);

  if (stars === null) {
    return (
      <span
        style={{
          fontSize: Math.max(9, size - 3),
          color: "#94A3B8",
          fontWeight: 800,
        }}
      >
        {station?.reliabilityLabel ||
          `Collecting live data${observations !== null ? ` (${observations})` : ""}`}
      </span>
    );
  }

  const full = Math.floor(stars);
  const half = stars - full === 0.5;
  const empty = Math.max(0, 5 - full - (half ? 1 : 0));

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        flexWrap: "wrap",
      }}
    >
      <span
        aria-label={`${stars.toFixed(1)} out of 5 stars, live observed`}
        style={{
          fontSize: size,
          color: "#F59E0B",
          letterSpacing: "1px",
          lineHeight: 1,
        }}
      >
        {"★".repeat(full)}
        {half ? "✬" : ""}
        {"☆".repeat(empty)}
      </span>

      {showLabel && (
        <span
          style={{
            fontSize: Math.max(8, size - 4),
            color: "#64748B",
            fontWeight: 800,
          }}
        >
          {stars.toFixed(1)}
          {observations !== null ? ` (${observations} obs.)` : ""}
        </span>
      )}
    </span>
  );
}

/* =========================================================
   LIVE AVAILABILITY & PORTS
========================================================= */

function availabilitySummary(station) {
  const available = safeNumber(
    station?.availablePorts ?? station?.available ?? station?.availability?.available
  );
  const total = safeNumber(
    station?.totalPorts ?? station?.total ?? station?.availability?.total
  );

  if (available === null || total === null || total <= 0 || available < 0) {
    return null;
  }

  return { available, total, label: `${available} / ${total} ports` };
}

function tomtomAvailabilitySummary(station) {
  const available = safeNumber(station?.tomtomAvailable);
  const total = safeNumber(station?.tomtomTotal);

  if (available === null || total === null || total <= 0 || available < 0) {
    return null;
  }

  return { available, total, label: `${available} / ${total} ports` };
}

function hasValidCoordinates(station) {
  const lat = safeNumber(station?.latitude);
  const lon = safeNumber(station?.longitude);

  return (
    lat !== null &&
    lon !== null &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function stationKey(station, index) {
  return (
    station?.id ||
    station?.stationId ||
    station?.uid ||
    `${station?.latitude}-${station?.longitude}-${index}`
  );
}

function formatBatteryPercent(telemetry) {
  const value = safeNumber(telemetry?.batteryPercent);
  return value === null ? "Unavailable" : `${value.toFixed(0)}%`;
}

function formatRangeKm(telemetry) {
  const value = safeNumber(telemetry?.rangeKm);
  return value === null ? "Unavailable" : `${value.toFixed(0)} km`;
}

function formatBatteryKwh(telemetry) {
  const value = safeNumber(telemetry?.batteryKwh);
  return value === null ? "Unavailable" : `${value.toFixed(1)} kWh`;
}

/* =========================================================
   MAIN DASHBOARD
========================================================= */

export default function UserDashboard({
  user,
  verifiedVehicle,
  apiBaseUrl,
  walletBalance,
  onLogout,
}) {
  const activeVehicle = verifiedVehicle || null;
  const API_BASE = apiBaseUrl || DEFAULT_API_BASE_URL;

  // Which page the sidebar is showing: dashboard | reserve | payment
  const [page, setPage] = useState("dashboard");
  const [reserveStationId, setReserveStationId] = useState(null);
  const [upcomingCount, setUpcomingCount] = useState(0);

  const [selectedRegion, setSelectedRegion] = useState(NL_REGIONS[0].id);
  const [locationMode, setLocationMode] = useState("NETHERLANDS_SIMULATED");
  const [currentCoords, setCurrentCoords] = useState({
    lat: NL_REGIONS[0].lat,
    lon: NL_REGIONS[0].lon,
    name: NL_REGIONS[0].name,
  });
  const [gpsMessage, setGpsMessage] = useState("Using Netherlands hub (Amsterdam).");

  const [stations, setStations] = useState([]);
  const [stationsLoading, setStationsLoading] = useState(false);
  const [stationsError, setStationsError] = useState("");
  const [selectedStation, setSelectedStation] = useState(null);

  const [navSimStation, setNavSimStation] = useState(null);
  const [navSimOpen, setNavSimOpen] = useState(false);

  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(REFRESH_SECONDS);
  const [backendHealth, setBackendHealth] = useState(null);

  const [query, setQuery] = useState("");
  const [chatLog, setChatLog] = useState([]);
  const [isAiLoading, setIsAiLoading] = useState(false);

  const [showStations, setShowStations] = useState(true);
  const [mapZoom, setMapZoom] = useState(13);
  const [filter, setFilter] = useState("ALL");
  const [stationSearch, setStationSearch] = useState("");

  const [telemetry, setTelemetry] = useState(null);
  const [telemetryStale, setTelemetryStale] = useState(true);
  const [smartcarConnected, setSmartcarConnected] = useState(false);
  const [smartcarInfo, setSmartcarInfo] = useState(null);

  const gpsWatchRef = useRef(null);
  const stationRequestRef = useRef(null);

  /* =======================================================
     VEHICLE STATUS
  ======================================================= */

  const vehicleVerified = Boolean(
    activeVehicle &&
      (activeVehicle.rdwVerified === true ||
        activeVehicle.rdwVerified === 1 ||
        activeVehicle.rdwVerified === "true")
  );

  const hasLiveTelemetry = Boolean(telemetry && !telemetryStale);

  /* =======================================================
     BACKEND HEALTH FLAGS
  ======================================================= */

  const ndwLive = Boolean(
    backendHealth?.liveSources?.ndw ??
      backendHealth?.ndwDynamic ??
      backendHealth?.ndw
  );

  const tomtomConfigured = Boolean(
    backendHealth?.liveSources?.tomtom ?? backendHealth?.tomtom
  );

  /* =======================================================
     REGION CHANGE
  ======================================================= */

  const handleRegionChange = useCallback((regionId) => {
    const region = NL_REGIONS.find((r) => r.id === regionId);
    if (!region) return;

    if (gpsWatchRef.current !== null) {
      navigator.geolocation?.clearWatch(gpsWatchRef.current);
      gpsWatchRef.current = null;
    }

    setSelectedRegion(region.id);
    setLocationMode("NETHERLANDS_SIMULATED");
    setCurrentCoords({ lat: region.lat, lon: region.lon, name: region.name });
    setGpsMessage(`Simulating position in ${region.name}, Netherlands.`);
  }, []);

  /* =======================================================
     REAL GPS
  ======================================================= */

  const enableRealGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsMessage("Geolocation is not supported by this browser.");
      return;
    }

    setGpsMessage("Requesting device GPS position...");

    if (gpsWatchRef.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchRef.current);
    }

    gpsWatchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;

        setCurrentCoords({ lat: latitude, lon: longitude, name: "Device GPS" });
        setLocationMode("GPS");
        setGpsMessage("Using live device GPS coordinates.");
      },
      () => {
        setGpsMessage("GPS unavailable. Reverted to Dutch region.");
        handleRegionChange(selectedRegion);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  }, [handleRegionChange, selectedRegion]);

  useEffect(() => {
    return () => {
      if (gpsWatchRef.current !== null) {
        navigator.geolocation?.clearWatch(gpsWatchRef.current);
      }
    };
  }, []);

  /* =======================================================
     BACKEND HEALTH
  ======================================================= */

  const fetchHealth = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/health`, {
        cache: "no-store",
      });

      if (!response.ok) throw new Error("Backend unavailable");

      setBackendHealth(await response.json());
    } catch {
      setBackendHealth(null);
    }
  }, [API_BASE]);

  useEffect(() => {
    fetchHealth();
    const timer = setInterval(fetchHealth, 30000);
    return () => clearInterval(timer);
  }, [fetchHealth]);

  /* =======================================================
     FETCH STATIONS
  ======================================================= */

  const fetchStations = useCallback(async () => {
    if (!currentCoords) return;

    if (stationRequestRef.current) {
      stationRequestRef.current.abort();
    }

    const controller = new AbortController();
    stationRequestRef.current = controller;

    setStationsLoading(true);
    setStationsError("");

    try {
      const params = new URLSearchParams({
        lat: String(currentCoords.lat),
        lng: String(currentCoords.lon),
        distance: "30",
      });

      const response = await fetch(
        `${API_BASE}/api/charging-stations?${params.toString()}`,
        { signal: controller.signal, cache: "no-store" }
      );

      const data = await response.json();

      if (!response.ok || data?.success !== true) {
        throw new Error(data?.error || "Charging data unavailable");
      }

      if (!Array.isArray(data?.stations)) {
        throw new Error("Invalid charging station response.");
      }

      const validStations = data.stations.filter(hasValidCoordinates);

      setStations(validStations);

      setSelectedStation((current) => {
        if (!current) return null;

        const currentId = stationKey(current, 0);
        const stillExists = validStations.some(
          (station) => stationKey(station, 0) === currentId
        );

        return stillExists ? current : null;
      });
    } catch (error) {
      if (error?.name === "AbortError") return;

      console.error("Charging station fetch failed:", error);
      setStations([]);
      setStationsError(
        error?.message || "Live charging infrastructure is unavailable."
      );
    } finally {
      if (stationRequestRef.current === controller) {
        stationRequestRef.current = null;
        setStationsLoading(false);
        // Restart the countdown after every finished request (success or not).
        setSecondsUntilRefresh(REFRESH_SECONDS);
      }
    }
  }, [API_BASE, currentCoords]);

  useEffect(() => {
    fetchStations();

    return () => {
      if (stationRequestRef.current) {
        stationRequestRef.current.abort();
      }
    };
  }, [fetchStations]);

  /* =======================================================
     AUTO REFRESH
     The countdown only counts; the fetch happens in its own
     effect (state updaters must stay free of side effects).
  ======================================================= */

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsUntilRefresh((value) => (value > 0 ? value - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (secondsUntilRefresh === 0) fetchStations();
  }, [secondsUntilRefresh, fetchStations]);

  /* =======================================================
     TELEMETRY
  ======================================================= */

  const fetchTelemetry = useCallback(async () => {
    if (!user?.uid) return;

    try {
      const response = await fetch(
        `${API_BASE}/api/vehicle-telemetry/${user.uid}`,
        { cache: "no-store" }
      );

      const data = await response.json();

      if (data?.success) {
        setTelemetry(data.telemetry || null);
        setTelemetryStale(!data.connected);
        setSmartcarConnected(Boolean(data.smartcarConnected));
      }
    } catch (error) {
      console.error("Telemetry fetch failed:", error);
    }
  }, [API_BASE, user?.uid]);

  useEffect(() => {
    fetchTelemetry();
    const timer = setInterval(fetchTelemetry, TELEMETRY_REFRESH_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [fetchTelemetry]);

  /* =======================================================
     WALLET / MOLLIE (membership + top-up)
  ======================================================= */

  const [wallet, setWallet] = useState({
    balance: walletBalance || 0,
    planType: null,
    activePlan: "STANDARD",
    paid: true,
  });
  const [walletLoaded, setWalletLoaded] = useState(false);
  const [topupAmount, setTopupAmount] = useState(10);
  const [topupBusy, setTopupBusy] = useState(false);
  const [topupNotice, setTopupNotice] = useState({ type: "", text: "" });

  const prevBalanceRef = useRef(null);
  const prevPlanRef = useRef(null);
  const topupReturnRef = useRef(
    typeof window !== "undefined" &&
      ["topup", "return"].includes(
        new URLSearchParams(window.location.search).get("trustcharge_payment")
      )
  );

  const fetchWalletStatus = useCallback(async () => {
    if (!user?.uid) return;

    try {
      const response = await fetch(
        `${API_BASE}/api/payments/status/${user.uid}`,
        { cache: "no-store" }
      );

      const data = await response.json();

      if (data?.success && data?.wallet) {
        setWallet(data.wallet);
        setWalletLoaded(true);
      }
    } catch (error) {
      console.error("Wallet status fetch failed:", error);
    }
  }, [API_BASE, user?.uid]);

  useEffect(() => {
    fetchWalletStatus();
  }, [fetchWalletStatus]);

  // Confirm whenever the loaded balance goes up (top-up, membership credit or
  // refund) and whenever a membership becomes active. Nothing is announced for
  // the very first load, only for changes after it.
  useEffect(() => {
    if (!walletLoaded) return;

    const balance = Number(wallet?.balance || 0);
    const previous = prevBalanceRef.current;

    if (previous !== null && balance > previous + 0.004) {
      setTopupNotice({
        type: "ok",
        text: `Wallet credited: €${(balance - previous).toFixed(2)} added.`,
      });
    }

    prevBalanceRef.current = balance;
  }, [wallet?.balance, walletLoaded]);

  useEffect(() => {
    if (!walletLoaded) return;

    const plan = wallet?.activePlan || "STANDARD";
    const previous = prevPlanRef.current;

    if (previous !== null && previous !== plan && plan !== "STANDARD") {
      setTopupNotice({
        type: "ok",
        text: `Membership active: ${PLAN_LABELS[plan] || plan}. Your benefits are unlocked.`,
      });
    }

    prevPlanRef.current = plan;
  }, [wallet?.activePlan, walletLoaded]);

  // Coming back from Mollie: clean the URL and poll until the credit shows up.
  useEffect(() => {
    if (!topupReturnRef.current || !user?.uid) return undefined;

    topupReturnRef.current = false;

    try {
      const params = new URLSearchParams(window.location.search);
      params.delete("trustcharge_payment");
      params.delete("firebaseUid");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash
      );
    } catch {
      /* non-critical */
    }

    setTopupNotice({ type: "info", text: "Checking your payment…" });

    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      fetchWalletStatus();
      if (tries >= 10) clearInterval(timer);
    }, 3000);

    fetchWalletStatus();

    return () => clearInterval(timer);
  }, [user?.uid, fetchWalletStatus]);

  // Refresh when the user returns to this tab (e.g. after paying in another tab).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchWalletStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchWalletStatus]);

  const startTopup = useCallback(async () => {
    if (!user?.uid || topupBusy) return;

    setTopupBusy(true);
    setTopupNotice({ type: "", text: "" });

    try {
      const response = await fetch(`${API_BASE}/api/payments/create-topup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firebaseUid: user.uid,
          email: user.email,
          amount: topupAmount,
          returnUrl: `${window.location.origin}${window.location.pathname}`,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data?.checkoutUrl) {
        throw new Error(data?.error || "Could not start the top-up.");
      }

      window.location.href = data.checkoutUrl;
    } catch (error) {
      setTopupNotice({
        type: "error",
        text: error?.message || "Could not start the top-up.",
      });
      setTopupBusy(false);
    }
  }, [API_BASE, user?.uid, user?.email, topupAmount, topupBusy]);

  const walletAmount = Number(wallet?.balance || 0);
  const activePlan = wallet?.activePlan || "STANDARD";
  const walletEmpty = walletLoaded && walletAmount <= WALLET_EMPTY_EUR;
  const walletLow = walletLoaded && !walletEmpty && walletAmount < WALLET_LOW_EUR;

  /* =======================================================
     RESERVATIONS (sidebar badge)
  ======================================================= */

  const fetchReservationCount = useCallback(async () => {
    if (!user?.uid) return;

    try {
      const response = await fetch(`${API_BASE}/api/reservations/user/${user.uid}`, {
        cache: "no-store",
      });

      const data = await response.json();

      if (data?.success) setUpcomingCount(Number(data.upcomingCount || 0));
    } catch (error) {
      console.error("Reservation count fetch failed:", error);
    }
  }, [API_BASE, user?.uid]);

  useEffect(() => {
    fetchReservationCount();
  }, [fetchReservationCount, page]);

  /* =======================================================
     SMARTCAR STATUS
  ======================================================= */

  const fetchSmartcarStatus = useCallback(async () => {
    if (!user?.uid) return;

    try {
      const response = await fetch(
        `${API_BASE}/api/smartcar/status/${user.uid}`,
        { cache: "no-store" }
      );

      const data = await response.json();

      if (data?.success) {
        setSmartcarInfo(data);
        setSmartcarConnected(Boolean(data.connected));
      }
    } catch (error) {
      console.error("Smartcar status fetch failed:", error);
    }
  }, [API_BASE, user?.uid]);

  useEffect(() => {
    fetchSmartcarStatus();
  }, [fetchSmartcarStatus]);

  const connectSmartcar = useCallback(() => {
    if (!user?.uid) return;

    window.location.href = `${API_BASE}/api/smartcar/connect?firebaseUid=${encodeURIComponent(
      user.uid
    )}`;
  }, [API_BASE, user?.uid]);

  const disconnectSmartcar = useCallback(async () => {
    if (!user?.uid) return;

    try {
      await fetch(`${API_BASE}/api/smartcar/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firebaseUid: user.uid }),
      });

      setSmartcarConnected(false);
      setSmartcarInfo(null);
      setTelemetry(null);
      setTelemetryStale(true);
    } catch (error) {
      console.error("Smartcar disconnect failed:", error);
    }
  }, [API_BASE, user?.uid]);

  const forceSmartcarRefresh = useCallback(async () => {
    if (!user?.uid) return;

    try {
      const response = await fetch(
        `${API_BASE}/api/smartcar/poll/${user.uid}`,
        { method: "POST" }
      );

      if (!response.ok) throw new Error("Smartcar refresh failed");

      await fetchTelemetry();
      await fetchSmartcarStatus();
    } catch (error) {
      console.error("Manual Smartcar refresh failed:", error);
    }
  }, [API_BASE, user?.uid, fetchTelemetry, fetchSmartcarStatus]);

  /* =======================================================
     FILTERED STATIONS
  ======================================================= */

  const filteredStations = useMemo(() => {
    let result = [...stations];

    const search = stationSearch.trim().toLowerCase();

    if (search) {
      const has = (value) => String(value || "").toLowerCase().includes(search);

      result = result.filter(
        (station) =>
          has(station.name) ||
          has(station.operator) ||
          has(station.address) ||
          has(station.city)
      );
    }

    if (filter === "AVAILABLE") {
      result = result.filter(
        (station) => getStationStatus(station) === "AVAILABLE"
      );
    }

    if (filter === "FAST") {
      result = result.filter((station) => {
        const power = safeNumber(
          station.powerKw ?? station.maxPowerKw ?? station.power
        );
        return power !== null && power >= 150;
      });
    }

    if (filter === "CHEAPEST") {
      result = result.filter((station) => safeNumber(station.pricePerKwh) !== null);
      result.sort((a, b) => Number(a.pricePerKwh) - Number(b.pricePerKwh));
    }

    if (filter === "RELIABLE") {
      result = result.filter((station) => safeNumber(station.reliability) !== null);
      result.sort((a, b) => Number(b.reliability) - Number(a.reliability));
    }

    return result;
  }, [stations, filter, stationSearch]);

  /* =======================================================
     STATION STATISTICS
  ======================================================= */

  const stationStats = useMemo(() => {
    const available = stations.filter(
      (station) => getStationStatus(station) === "AVAILABLE"
    ).length;

    const tomtomMatched = stations.filter(
      (station) => station?.tomtomLive === true
    ).length;

    const tomtomLive = stations.filter(
      (station) => tomtomAvailabilitySummary(station) !== null
    ).length;

    return { total: stations.length, available, tomtomMatched, tomtomLive };
  }, [stations]);

  /* =======================================================
     MAP
  ======================================================= */

  const mapCenter = useMemo(
    () => (currentCoords ? [currentCoords.lat, currentCoords.lon] : null),
    [currentCoords]
  );

  const selectStation = useCallback((station) => {
    setSelectedStation(station);
    setMapZoom(15);
  }, []);

  const recenterMap = useCallback(() => {
    setMapZoom(locationMode === "GPS" ? 14 : 13);
  }, [locationMode]);

  /* =======================================================
     AI COPILOT
  ======================================================= */

  async function handleAiSubmit(event) {
    event.preventDefault();

    if (!query.trim() || isAiLoading) return;

    const userText = query.trim();

    const previousHistory = chatLog.map((item) => ({
      role: item.sender === "user" ? "user" : "model",
      content: item.text,
    }));

    setChatLog((previous) => [...previous, { sender: "user", text: userText }]);
    setQuery("");
    setIsAiLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/ai/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          history: previousHistory,
          context: {
            vehicle: activeVehicle || null,
            telemetry: telemetry || null,
            gps: currentCoords || null,
            selectedStation: selectedStation || null,
            stations: stations.slice(0, 25),
          },
        }),
      });

      const data = await response.json();

      if (!response.ok || data?.success !== true) {
        throw new Error(data?.error || "AI response failed");
      }

      setChatLog((previous) => [...previous, { sender: "ai", text: data.answer }]);
    } catch (error) {
      console.error("AI request failed:", error);

      setChatLog((previous) => [
        ...previous,
        {
          sender: "ai",
          text: "Cannot connect to live TrustCharge AI data. No chargers, prices, availability, or reliability values will be fabricated.",
        },
      ]);
    } finally {
      setIsAiLoading(false);
    }
  }

  /* =======================================================
     NAVIGATION / TRIP SIMULATION
  ======================================================= */

  function openNavigation(station) {
    setNavSimStation(station || null);
    setNavSimOpen(true);
  }

  function openTripPlanner() {
    setNavSimStation(null);
    setNavSimOpen(true);
  }

  function openReservation(station) {
    setReserveStationId(station?.id ?? null);
    setPage("reserve");
  }

  function openExternalMaps(station) {
    if (!station) return;

    const lat = safeNumber(station.latitude);
    const lon = safeNumber(station.longitude);

    if (lat === null || lon === null) return;

    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  function closeNavSim() {
    setNavSimOpen(false);
    setNavSimStation(null);
  }

  // The Simulation reports a confirmed top-up so the dashboard wallet updates.
  function handleWalletUpdate(newBalance) {
    if (safeNumber(newBalance) === null) return;
    setWallet((prev) => ({ ...prev, balance: newBalance }));
    setWalletLoaded(true);
  }

  // Called when Simulation finishes a trip (drive + charge).
  function handleTripComplete({
    batteryPercent,
    batteryKwh,
    rangeKm,
    walletBalance: newWalletBalance,
    latitude,
    longitude,
    label,
  }) {
    if (safeNumber(batteryPercent) !== null) {
      setTelemetry((prev) => ({
        ...(prev || {}),
        batteryPercent,
        batteryKwh: safeNumber(batteryKwh) ?? prev?.batteryKwh ?? null,
        rangeKm: safeNumber(rangeKm) ?? prev?.rangeKm ?? null,
        latitude: safeNumber(latitude) ?? prev?.latitude ?? null,
        longitude: safeNumber(longitude) ?? prev?.longitude ?? null,
        isCharging: false,
        source: "Simulation Complete",
        createdAt: new Date().toISOString(),
      }));

      setTelemetryStale(false);
    }

    if (safeNumber(newWalletBalance) !== null) {
      setWallet((prev) => ({ ...prev, balance: newWalletBalance }));
    }

    // The car is now at the destination: move the dashboard there too.
    if (safeNumber(latitude) !== null && safeNumber(longitude) !== null) {
      if (gpsWatchRef.current !== null) {
        navigator.geolocation?.clearWatch(gpsWatchRef.current);
        gpsWatchRef.current = null;
      }

      setLocationMode("NETHERLANDS_SIMULATED");
      setCurrentCoords({
        lat: latitude,
        lon: longitude,
        name: label || "Trip destination",
      });
      setGpsMessage(`Vehicle arrived at ${label || "the trip destination"}.`);
    }

    fetchTelemetry();
    fetchWalletStatus();
  }

  /* =======================================================
     RENDER
  ======================================================= */

  const topupPanel = (
    <div style={styles.topupBox}>
      <div style={styles.topupAmounts}>
        {TOPUP_AMOUNTS.map((amount) => (
          <button
            key={amount}
            type="button"
            className="tc-button"
            disabled={topupBusy}
            onClick={() => setTopupAmount(amount)}
            style={{
              ...styles.topupChip,
              ...(topupAmount === amount ? styles.topupChipActive : {}),
            }}
          >
            €{amount}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="tc-button"
        disabled={topupBusy || !user?.uid}
        onClick={startTopup}
        style={styles.topupButton}
      >
        {topupBusy ? "Redirecting to Mollie…" : `TOP UP €${topupAmount} WITH MOLLIE`}
      </button>
    </div>
  );

  return (
    <div style={styles.appContainer}>
      <style>
        {`
          @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }

          .tc-shell { display:flex; min-height:100dvh; width:100%; }
          .tc-content { flex:1; min-width:0; }

          .tc-sidebar {
            width:232px; flex:0 0 232px; position:sticky; top:0; align-self:flex-start;
            height:100dvh; box-sizing:border-box; padding:20px 14px;
            background:#0B1120; color:#E2E8F0; display:flex; flex-direction:column; gap:18px;
            border-right:1px solid #1E293B; z-index:20;
          }
          .tc-side-brand { font-weight:900; letter-spacing:.08em; font-size:16px; padding:0 8px; }
          .tc-side-brand small { display:block; margin-top:4px; font-size:9px; color:#64748B; letter-spacing:.16em; font-weight:700; }
          .tc-nav { display:flex; flex-direction:column; gap:6px; }
          .tc-nav-item {
            display:flex; align-items:center; gap:10px; width:100%; text-align:left;
            border:1px solid transparent; background:transparent; color:#CBD5E1;
            padding:11px 12px; border-radius:10px; cursor:pointer;
            font-size:12px; font-weight:700; font-family:inherit; white-space:nowrap;
          }
          .tc-nav-item:hover { background:#111A2E; }
          .tc-nav-item.active { background:#F59E0B; color:#111827; font-weight:900; }
          .tc-nav-icon { width:20px; text-align:center; flex-shrink:0; }
          .tc-nav-badge {
            margin-left:auto; background:#EF4444; color:#FFFFFF; border-radius:999px;
            min-width:18px; height:18px; padding:0 5px; display:inline-flex;
            align-items:center; justify-content:center; font-size:10px; font-weight:900;
          }
          .tc-side-foot { margin-top:auto; display:flex; flex-direction:column; gap:10px; }
          .tc-side-plan { background:#111A2E; border:1px solid #1E293B; border-radius:12px; padding:12px; }
          .tc-side-plan-label { font-size:9px; color:#64748B; font-weight:800; letter-spacing:.14em; }
          .tc-side-plan-value { margin-top:4px; font-size:13px; font-weight:900; color:#FCD34D; }
          .tc-side-plan-wallet { margin-top:6px; font-size:11px; color:#94A3B8; }

          .tc-button:hover { transform:translateY(-1px); }
          .tc-station-row:hover { transform:translateY(-1px); border-color:#F59E0B !important; }
          .tc-filter:hover { border-color:#F59E0B !important; }

          input:focus, select:focus {
            outline:none;
            border-color:#F59E0B !important;
            box-shadow:0 0 0 3px rgba(245,158,11,.15) !important;
          }

          ::-webkit-scrollbar { width:6px; }
          ::-webkit-scrollbar-track { background:#F1F5F9; }
          ::-webkit-scrollbar-thumb { background:#CBD5E1; border-radius:4px; }
          ::-webkit-scrollbar-thumb:hover { background:#94A3B8; }

          @media(max-width:1150px) {
            .tc-main-grid { grid-template-columns:minmax(260px,1fr) minmax(420px,1.5fr); }
            .tc-profile-column { grid-column:1 / -1; }
          }

          @media(max-width:900px) {
            .tc-shell { flex-direction:column; }
            .tc-sidebar {
              width:100%; flex:none; height:auto; position:static; flex-direction:row;
              align-items:center; padding:8px 10px; gap:8px; overflow-x:auto;
            }
            .tc-side-brand, .tc-side-foot { display:none; }
            .tc-nav { flex-direction:row; }
          }

          @media(max-width:800px) {
            .tc-main-grid { grid-template-columns:1fr; }
            .tc-metrics { grid-template-columns:1fr 1fr; }
            .tc-header { flex-direction:column; align-items:flex-start !important; }
            .tc-map { height:380px !important; }
          }

          @media(max-width:520px) {
            .tc-metrics { grid-template-columns:1fr; }
            .tc-region-grid { grid-template-columns:1fr; }
          }
        `}
      </style>

      {navSimOpen && (
        <Simulation
          station={navSimStation}
          currentCoords={currentCoords}
          apiBaseUrl={API_BASE}
          firebaseUid={user?.uid}
          vehicle={activeVehicle}
          telemetry={telemetry}
          wallet={wallet}
          onClose={closeNavSim}
          onTripComplete={handleTripComplete}
          onOpenExternalMaps={openExternalMaps}
          onWalletUpdate={handleWalletUpdate}
        />
      )}

      <div className="tc-shell">
        {/* SIDEBAR */}

        <aside className="tc-sidebar" aria-label="Main navigation">
          <div className="tc-side-brand">
            ⚡ TRUSTCHARGE
            <small>EV CONTROL CENTER</small>
          </div>

          <nav className="tc-nav">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`tc-nav-item${page === item.id ? " active" : ""}`}
                aria-current={page === item.id ? "page" : undefined}
                onClick={() => setPage(item.id)}
              >
                <span className="tc-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
                {item.id === "reserve" && upcomingCount > 0 && (
                  <span className="tc-nav-badge">{upcomingCount}</span>
                )}
              </button>
            ))}
          </nav>

          <div className="tc-side-foot">
            <div className="tc-side-plan">
              <div className="tc-side-plan-label">MEMBERSHIP</div>
              <div className="tc-side-plan-value">{PLAN_LABELS[activePlan] || "STANDARD"}</div>
              <div className="tc-side-plan-wallet">Wallet €{walletAmount.toFixed(2)}</div>
            </div>

            <button type="button" className="tc-nav-item" onClick={onLogout}>
              <span className="tc-nav-icon">⏻</span>
              <span>Disconnect</span>
            </button>
          </div>
        </aside>

        <div className="tc-content">
          {/* HEADER */}

          <header className="tc-header" style={styles.header}>
            <div>
              <div style={styles.logo}>⚡ TRUSTCHARGE</div>
              <div style={styles.headerSubtitle}>
                NETHERLANDS EV INFRASTRUCTURE // LIVE HUD
              </div>
            </div>

            <div style={styles.headerRight}>
              <div style={ndwLive ? styles.liveBadge : styles.offlineBadge}>
                <span style={ndwLive ? styles.liveDot : styles.offlineDot} />
                NDW {ndwLive ? "LIVE" : "OFFLINE"}
              </div>

              <div
                style={walletEmpty ? styles.walletBadgeEmpty : styles.walletBadge}
              >
                WALLET €{walletAmount.toFixed(2)}
              </div>

              <div style={styles.userEmail}>{user?.email || "USER"}</div>

              <button
                type="button"
                className="tc-button"
                onClick={onLogout}
                style={styles.disconnectButton}
              >
                DISCONNECT
              </button>
            </div>
          </header>

          {page === "reserve" ? (
            <main style={styles.mainContainer}>
              {topupNotice.text && (
                <section
                  style={
                    topupNotice.type === "error"
                      ? styles.noticeError
                      : topupNotice.type === "ok"
                      ? styles.noticeOk
                      : styles.noticeInfo
                  }
                >
                  {topupNotice.text}
                  <button
                    type="button"
                    onClick={() => setTopupNotice({ type: "", text: "" })}
                    style={styles.noticeClose}
                  >
                    ✕
                  </button>
                </section>
              )}

              <Reservation
                user={user}
                apiBaseUrl={API_BASE}
                stations={stations}
                currentCoords={currentCoords}
                wallet={wallet}
                initialStationId={reserveStationId}
                onNavigate={setPage}
                onWalletRefresh={fetchWalletStatus}
                onReservationsChanged={fetchReservationCount}
              />
            </main>
          ) : page === "payment" ? (
            <main style={styles.mainContainer}>
              <PaymentIntegration
                embedded
                currentUser={user}
                apiBaseUrl={API_BASE}
                onBack={() => setPage("dashboard")}
                onMembershipChange={fetchWalletStatus}
              />
            </main>
          ) : (
            <main style={styles.mainContainer}>
              {/* WALLET BANNER */}

              {(walletEmpty || walletLow) && (
                <section
                  style={walletEmpty ? styles.walletBannerEmpty : styles.walletBannerLow}
                >
                  <div style={{ flex: 1, minWidth: "220px" }}>
                    <div style={styles.walletBannerTitle}>
                      {walletEmpty
                        ? "Your wallet is empty — top up to keep charging"
                        : `Your wallet is running low (€${walletAmount.toFixed(2)})`}
                    </div>
                    <div style={styles.walletBannerText}>
                      Charging sessions are billed from your wallet. Add credit with
                      Mollie so trips are not interrupted.
                    </div>
                  </div>
                  {topupPanel}
                </section>
              )}

              {topupNotice.text && (
                <section
                  style={
                    topupNotice.type === "error"
                      ? styles.noticeError
                      : topupNotice.type === "ok"
                      ? styles.noticeOk
                      : styles.noticeInfo
                  }
                >
                  {topupNotice.text}
                  <button
                    type="button"
                    onClick={() => setTopupNotice({ type: "", text: "" })}
                    style={styles.noticeClose}
                  >
                    ✕
                  </button>
                </section>
              )}

              {/* VEHICLE STRIP */}

              <section style={styles.vehicleStrip}>
                <div>
                  <div style={styles.eyebrow}>VEHICLE IDENTITY</div>
                  <div style={styles.vehicleStripTitle}>
                    {getVehicleName(activeVehicle)}
                  </div>
                  <div style={styles.vehicleStripSub}>
                    {getPlate(activeVehicle) || "NO PLATE"}
                    {" • "}
                    SQLite account registry
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="tc-button"
                    onClick={openTripPlanner}
                    style={styles.planTripButton}
                  >
                    🧭 PLAN A TRIP
                  </button>

                  <button
                    type="button"
                    className="tc-button"
                    onClick={() => openReservation(selectedStation)}
                    style={styles.reserveButton}
                  >
                    🎟 RESERVE A PORT
                  </button>

                  <div
                    style={vehicleVerified ? styles.verifiedBadge : styles.unverifiedBadge}
                  >
                    {vehicleVerified ? "✓ RDW VERIFIED" : "⚠ NOT VERIFIED"}
                  </div>
                </div>
              </section>

              {/* LOCATION ENGINE */}

              <section style={styles.controlCard}>
                <div style={styles.sectionHeader}>
                  <div>
                    <div style={styles.eyebrow}>LOCATION ENGINE</div>
                    <div style={styles.sectionTitle}>Infrastructure Region</div>
                  </div>

                  <div style={styles.locationStatus}>
                    {locationMode === "GPS" ? "● DEVICE GPS" : "● DUTCH HUB"}
                  </div>
                </div>

                <div className="tc-region-grid" style={styles.regionGrid}>
                  <select
                    value={selectedRegion}
                    onChange={(event) => handleRegionChange(event.target.value)}
                    style={styles.select}
                  >
                    {NL_REGIONS.map((region) => (
                      <option key={region.id} value={region.id}>
                        {region.name} — Netherlands
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    className="tc-button"
                    onClick={enableRealGps}
                    style={styles.gpsButton}
                  >
                    ◎ USE DEVICE GPS
                  </button>
                </div>

                <div style={styles.gpsMessage}>{gpsMessage}</div>
              </section>

              {/* METRICS */}

              <section className="tc-metrics" style={styles.metricsGrid}>
                <MetricCard
                  label="DATA REGION"
                  value={currentCoords?.name || "Unknown"}
                  sub={locationMode === "GPS" ? "DEVICE GPS" : "SIMULATED HUB"}
                />

                <MetricCard
                  label="LIVE NODES"
                  value={stationStats.total}
                  sub={ndwLive ? "NDW LIVE" : "NDW OFFLINE"}
                />

                <MetricCard
                  label="AVAILABLE"
                  value={stationStats.available}
                  sub="EXPLICIT LIVE STATUS"
                />

                <MetricCard
                  label="TOMTOM"
                  value={!tomtomConfigured ? "—" : stationStats.tomtomLive}
                  sub={
                    !tomtomConfigured
                      ? "NOT CONFIGURED"
                      : stationStats.tomtomLive > 0
                      ? "LIVE AVAILABILITY"
                      : "CONNECTED / NO LIVE COUNTS"
                  }
                />
              </section>

              {/* MAIN GRID */}

              <div className="tc-main-grid" style={styles.gridContainer}>
                {/* LEFT COLUMN */}

                <div>
                  {/* VEHICLE */}

                  <section style={styles.card}>
                    <SectionHeading eyebrow="VEHICLE" title="Active Vehicle" />

                    <div style={styles.vehicleVisual}>
                      <div style={styles.vehicleEmoji}>🚙</div>

                      <div>
                        <div style={styles.cardTitle}>{getVehicleName(activeVehicle)}</div>
                        <div style={styles.muted}>
                          Plate: {getPlate(activeVehicle) || "Unavailable"}
                        </div>
                      </div>
                    </div>

                    <div style={styles.statusRow}>
                      <span
                        style={vehicleVerified ? styles.smallGreenBadge : styles.smallGrayBadge}
                      >
                        {vehicleVerified ? "RDW VERIFIED" : "NOT VERIFIED"}
                      </span>

                      <span
                        style={hasLiveTelemetry ? styles.smallGreenBadge : styles.smallGrayBadge}
                      >
                        {hasLiveTelemetry
                          ? "TELEMETRY LIVE"
                          : telemetry
                          ? "TELEMETRY STALE"
                          : "NO TELEMETRY"}
                      </span>
                    </div>

                    {!smartcarConnected && (
                      <button
                        type="button"
                        className="tc-button"
                        onClick={connectSmartcar}
                        style={styles.smartcarButton}
                      >
                        🔌 CONNECT VEHICLE (SMARTCAR)
                      </button>
                    )}

                    {smartcarConnected && (
                      <div style={styles.smartcarRow}>
                        <button
                          type="button"
                          className="tc-button"
                          onClick={forceSmartcarRefresh}
                          style={styles.smartcarButtonSecondary}
                        >
                          ↻ REFRESH
                        </button>

                        <button
                          type="button"
                          className="tc-button"
                          onClick={disconnectSmartcar}
                          style={styles.smartcarButtonGhost}
                        >
                          DISCONNECT
                        </button>
                      </div>
                    )}

                    {telemetry && (
                      <div style={styles.guidanceGrid}>
                        <MiniStat label="BATTERY" value={formatBatteryPercent(telemetry)} />
                        <MiniStat label="RANGE" value={formatRangeKm(telemetry)} />
                        <MiniStat label="STORED ENERGY" value={formatBatteryKwh(telemetry)} />
                      </div>
                    )}

                    {telemetry?.createdAt && (
                      <div style={styles.muted}>
                        Last live reading:{" "}
                        {new Date(telemetry.createdAt).toLocaleTimeString()}
                        {telemetryStale ? " (stale — reconnect or refresh)" : ""}
                      </div>
                    )}

                    {smartcarInfo?.connected && (
                      <div style={styles.muted}>
                        Smartcar reports: {smartcarInfo.smartcarMake}{" "}
                        {smartcarInfo.smartcarModel}
                        {smartcarInfo.smartcarYear ? ` (${smartcarInfo.smartcarYear})` : ""}
                        <br />
                        RDW record: {smartcarInfo.rdwMerk} {smartcarInfo.rdwModel}
                        <br />
                        {smartcarInfo.modelMatchConfirmed
                          ? "✓ Make/model consistent with RDW record"
                          : "⚠ Could not confirm make/model match — RDW does not expose VIN for cryptographic verification"}
                      </div>
                    )}
                  </section>

                  {/* NAVIGATION */}

                  <section style={styles.card}>
                    <SectionHeading eyebrow="NAVIGATION" title="Active Guidance" />

                    {selectedStation ? (
                      <>
                        <div style={styles.guidanceName}>{selectedStation.name}</div>

                        <div style={styles.guidanceAddress}>
                          {selectedStation.address || "Address unavailable"}
                        </div>

                        <div style={styles.guidanceGrid}>
                          <MiniStat
                            label="DISTANCE"
                            value={formatDistance(selectedStation)}
                          />

                          <MiniStat label="POWER" value={formatPower(selectedStation)} />

                          <div style={styles.miniStat}>
                            <div style={styles.miniLabel}>RELIABILITY</div>

                            <div style={{ ...styles.miniValue, marginTop: "5px" }}>
                              <StarRating station={selectedStation} size={12} />
                            </div>
                          </div>
                        </div>

                        {reliabilitySourcesText(selectedStation) && (
                          <div style={styles.muted}>
                            Sources: {reliabilitySourcesText(selectedStation)}
                          </div>
                        )}

                        <div style={styles.priceGuidance}>
                          Tariff: {formatPrice(selectedStation)}
                        </div>

                        {availabilitySummary(selectedStation) && (
                          <div style={styles.liveAvailabilityGuidance}>
                            Live availability: {availabilitySummary(selectedStation).label}
                          </div>
                        )}

                        <button
                          type="button"
                          className="tc-button"
                          onClick={() => openNavigation(selectedStation)}
                          style={styles.navigationButton}
                        >
                          ↗ LAUNCH NAVIGATION
                        </button>

                        <button
                          type="button"
                          className="tc-button"
                          onClick={() => openReservation(selectedStation)}
                          style={styles.reserveWideButton}
                        >
                          🎟 RESERVE A PORT HERE
                        </button>
                      </>
                    ) : (
                      <div style={styles.emptyState}>
                        Select a live charging station from the map or station list, or
                        plan a trip above.
                      </div>
                    )}
                  </section>

                  {/* AI */}

                  <section style={styles.card}>
                    <SectionHeading eyebrow="AI COPILOT" title="TrustCharge Assistant" />

                    <div style={styles.chatBox}>
                      {chatLog.length === 0 ? (
                        <div style={styles.chatEmpty}>
                          Ask about your verified vehicle, nearby chargers, charging
                          power, or live availability.
                        </div>
                      ) : (
                        chatLog.map((item, index) => (
                          <div
                            key={`${item.sender}-${index}`}
                            style={item.sender === "user" ? styles.userMessage : styles.aiMessage}
                          >
                            <div style={styles.messageLabel}>
                              {item.sender === "user" ? "YOU" : "TRUSTCHARGE AI"}
                            </div>

                            <div>{item.text}</div>
                          </div>
                        ))
                      )}

                      {isAiLoading && (
                        <div style={styles.aiMessage}>
                          <div style={styles.messageLabel}>TRUSTCHARGE AI</div>
                          Processing live context...
                        </div>
                      )}
                    </div>

                    <form onSubmit={handleAiSubmit} style={styles.chatForm}>
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Ask TrustCharge..."
                        style={styles.chatInput}
                        disabled={isAiLoading}
                      />

                      <button
                        type="submit"
                        className="tc-button"
                        style={styles.sendButton}
                        disabled={isAiLoading || !query.trim()}
                      >
                        SEND
                      </button>
                    </form>
                  </section>
                </div>

                {/* CENTER COLUMN */}

                <div>
                  {/* MAP */}

                  <section style={styles.card}>
                    <div style={styles.mapHeader}>
                      <div>
                        <div style={styles.eyebrow}>LIVE CHARGING MAP</div>
                        <div style={styles.sectionTitle}>Dutch Charging Infrastructure</div>
                      </div>

                      <div style={styles.refreshBadge}>SYNC {secondsUntilRefresh}s</div>
                    </div>

                    {stationsError && (
                      <div style={styles.errorBanner}>⚠ {stationsError}</div>
                    )}

                    <div className="tc-map" style={styles.mapStage}>
                      {mapCenter && (
                        <MapContainer
                          center={mapCenter}
                          zoom={mapZoom}
                          scrollWheelZoom={true}
                          style={styles.map}
                        >
                          <MapController center={mapCenter} zoom={mapZoom} />

                          <TileLayer
                            attribution="© OpenStreetMap contributors"
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                          />

                          <Marker position={mapCenter} icon={userIcon}>
                            <Popup>
                              <strong>Your position</strong>
                              <br />
                              {currentCoords?.name}
                            </Popup>
                          </Marker>

                          {showStations &&
                            filteredStations.filter(hasValidCoordinates).map((station, index) => {
                              const status = getStationStatus(station);
                              const key = stationKey(station, index);
                              const availability = availabilitySummary(station);
                              const tomtomAvailability = tomtomAvailabilitySummary(station);

                              return (
                                <Marker
                                  key={key}
                                  position={[Number(station.latitude), Number(station.longitude)]}
                                  icon={stationIcon(status)}
                                  eventHandlers={{ click: () => selectStation(station) }}
                                >
                                  <Popup>
                                    <div style={{ minWidth: "230px" }}>
                                      <strong>{station.name}</strong>
                                      <br />

                                      <span style={{ color: statusColor(status) }}>
                                        {statusLabel(status)}
                                      </span>

                                      <hr />

                                      <div>{formatPower(station)}</div>
                                      <div>Tariff: {formatPrice(station)}</div>

                                      <div style={{ marginTop: "4px" }}>
                                        Reliability: <StarRating station={station} size={12} />
                                      </div>

                                      {reliabilitySourcesText(station) && (
                                        <div>Sources: {reliabilitySourcesText(station)}</div>
                                      )}

                                      {availability && (
                                        <div>NDW live ports: {availability.label}</div>
                                      )}

                                      {tomtomAvailability && (
                                        <div>TomTom live ports: {tomtomAvailability.label}</div>
                                      )}

                                      <div style={{ display: "flex", gap: "6px", marginTop: "10px" }}>
                                        <button
                                          type="button"
                                          onClick={() => openNavigation(station)}
                                          style={{
                                            padding: "8px 10px",
                                            border: "none",
                                            borderRadius: "8px",
                                            background: "#111827",
                                            color: "#FFFFFF",
                                            cursor: "pointer",
                                          }}
                                        >
                                          Navigate
                                        </button>

                                        <button
                                          type="button"
                                          onClick={() => openReservation(station)}
                                          style={{
                                            padding: "8px 10px",
                                            border: "none",
                                            borderRadius: "8px",
                                            background: "#F59E0B",
                                            color: "#111827",
                                            cursor: "pointer",
                                            fontWeight: 700,
                                          }}
                                        >
                                          Reserve
                                        </button>
                                      </div>
                                    </div>
                                  </Popup>
                                </Marker>
                              );
                            })}
                        </MapContainer>
                      )}

                      <div style={styles.mapToolbar}>
                        <button
                          type="button"
                          className="tc-button"
                          onClick={() => setShowStations((value) => !value)}
                          style={styles.mapToolButton}
                        >
                          ⚡ Stations ({filteredStations.length})
                        </button>

                        <button
                          type="button"
                          className="tc-button"
                          onClick={recenterMap}
                          style={styles.mapToolButton}
                        >
                          ◎ Recenter
                        </button>
                      </div>

                      {stationsLoading && (
                        <div style={styles.loadingOverlay}>
                          <div style={styles.spinner} />
                          SYNCING LIVE INFRASTRUCTURE
                        </div>
                      )}
                    </div>
                  </section>

                  {/* STATION LIST */}

                  <section style={styles.card}>
                    <div style={styles.mapHeader}>
                      <div>
                        <div style={styles.eyebrow}>LIVE NODES</div>
                        <div style={styles.sectionTitle}>Nearby Charging Stations</div>
                      </div>

                      <div style={styles.nodeCount}>{filteredStations.length} SHOWN</div>
                    </div>

                    <input
                      value={stationSearch}
                      onChange={(event) => setStationSearch(event.target.value)}
                      placeholder="Search station, operator, address..."
                      style={styles.stationSearch}
                    />

                    <div style={styles.filterRow}>
                      {["ALL", "AVAILABLE", "FAST", "CHEAPEST", "RELIABLE"].map((item) => (
                        <button
                          type="button"
                          key={item}
                          className="tc-filter"
                          onClick={() => setFilter(item)}
                          style={{
                            ...styles.filterButton,
                            ...(filter === item ? styles.filterButtonActive : {}),
                          }}
                        >
                          {item}
                        </button>
                      ))}
                    </div>

                    <div style={styles.stationList}>
                      {filteredStations.length === 0 ? (
                        <div style={styles.emptyStations}>
                          <div style={{ fontSize: "30px", marginBottom: "10px" }}>⚡</div>

                          <strong>No live stations match this filter.</strong>

                          <div style={styles.muted}>
                            TrustCharge will not create placeholder stations.
                          </div>
                        </div>
                      ) : (
                        filteredStations.map((station, index) => {
                          const status = getStationStatus(station);

                          const selected =
                            selectedStation &&
                            stationKey(selectedStation, 0) === stationKey(station, index);

                          const availability = availabilitySummary(station);

                          return (
                            <button
                              type="button"
                              key={stationKey(station, index)}
                              className="tc-station-row"
                              onClick={() => selectStation(station)}
                              style={{
                                ...styles.stationRow,
                                ...(selected ? styles.stationRowSelected : {}),
                              }}
                            >
                              <div style={styles.stationStatusColumn}>
                                <div
                                  style={{ ...styles.statusDot, background: statusColor(status) }}
                                />

                                <div
                                  style={{ ...styles.statusText, color: statusColor(status) }}
                                >
                                  {statusLabel(status)}
                                </div>
                              </div>

                              <div style={styles.stationMain}>
                                <div style={styles.stationName}>{station.name}</div>

                                <div style={styles.stationMeta}>
                                  {station.operator || "Unknown operator"}
                                </div>

                                <div style={styles.stationAddress}>
                                  {station.address || "Address unavailable"}
                                </div>

                                <div style={{ marginTop: "5px" }}>
                                  <StarRating station={station} size={10} />
                                </div>

                                {availability && (
                                  <div style={styles.availabilityBadge}>
                                    PORTS: {availability.label}
                                  </div>
                                )}
                              </div>

                              <div style={styles.stationRight}>
                                <div style={styles.stationDistance}>{formatDistance(station)}</div>
                                <div style={styles.stationPower}>{formatPower(station)}</div>
                                <div style={styles.stationPrice}>{formatPrice(station)}</div>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </section>
                </div>

                {/* RIGHT PROFILE COLUMN */}

                <div className="tc-profile-column">
                  <section style={styles.card}>
                    <SectionHeading eyebrow="ACCOUNT" title="Active Profile" />

                    <div style={styles.profileAvatar}>⚡</div>

                    <div style={styles.profileName}>
                      {user?.displayName || "TrustCharge User"}
                    </div>

                    <div style={styles.profileEmail}>{user?.email || "No email"}</div>

                    <div style={styles.profileDivider} />

                    <ProfileRow label="ROLE" value={user?.role?.toUpperCase() || "USER"} />
                    <ProfileRow label="VEHICLE" value={getVehicleName(activeVehicle)} />
                    <ProfileRow label="PLATE" value={getPlate(activeVehicle) || "Unavailable"} />
                    <ProfileRow label="RDW" value={vehicleVerified ? "VERIFIED" : "NOT VERIFIED"} />
                    <ProfileRow
                      label="LOCATION"
                      value={locationMode === "GPS" ? "DEVICE GPS" : "NL HUB"}
                    />
                    <ProfileRow
                      label="SMARTCAR"
                      value={smartcarConnected ? "CONNECTED" : "NOT CONNECTED"}
                    />

                    <div style={styles.profileDivider} />

                    <ProfileRow
                      label="MEMBERSHIP"
                      value={PLAN_LABELS[activePlan] || "STANDARD"}
                    />

                    {wallet?.benefits && (
                      <>
                        <ProfileRow
                          label="ENERGY DISCOUNT"
                          value={
                            wallet.benefits.energyDiscountPct > 0
                              ? `${wallet.benefits.energyDiscountPct}% OFF`
                              : "NONE"
                          }
                        />
                        <ProfileRow
                          label="RESERVATION FEE"
                          value={
                            wallet.benefits.reservationFeeDiscountPct >= 100
                              ? "FREE"
                              : wallet.benefits.reservationFeeDiscountPct > 0
                              ? `${wallet.benefits.reservationFeeDiscountPct}% OFF`
                              : "STANDARD"
                          }
                        />
                      </>
                    )}

                    <ProfileRow label="WALLET" value={`€${walletAmount.toFixed(2)}`} />

                    <button
                      type="button"
                      className="tc-button"
                      onClick={() => setPage("payment")}
                      style={styles.membershipButton}
                    >
                      {activePlan === "PRO" ? "MANAGE MEMBERSHIP" : "⭐ UPGRADE MEMBERSHIP"}
                    </button>

                    <div style={styles.profileNote}>
                      Vehicle ownership is linked to your Firebase UID and persisted in
                      the TrustCharge SQLite account registry.
                    </div>
                  </section>

                  {/* WALLET TOP-UP */}

                  <section style={styles.card}>
                    <SectionHeading eyebrow="WALLET" title="Top up credit" />

                    <div style={walletEmpty ? styles.walletBigEmpty : styles.walletBig}>
                      €{walletAmount.toFixed(2)}
                    </div>

                    <div style={styles.muted}>
                      {walletEmpty
                        ? "Your wallet is empty. Top up to continue charging."
                        : "Available for charging sessions and port reservations."}
                    </div>

                    <div style={{ marginTop: "12px" }}>{topupPanel}</div>

                    <div style={styles.profileNote}>
                      Payments are handled securely by Mollie. Credit is added as soon
                      as the payment is confirmed.
                    </div>
                  </section>
                </div>
              </div>
            </main>
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   COMPONENTS
========================================================= */

function MetricCard({ label, value, sub }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.eyebrow}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
      <div style={styles.metricSub}>{sub}</div>
    </div>
  );
}

function SectionHeading({ eyebrow, title }) {
  return (
    <div style={styles.sectionHeading}>
      <div style={styles.eyebrow}>{eyebrow}</div>
      <div style={styles.sectionTitle}>{title}</div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div style={styles.miniStat}>
      <div style={styles.miniLabel}>{label}</div>
      <div style={styles.miniValue}>{value}</div>
    </div>
  );
}

function ProfileRow({ label, value }) {
  return (
    <div style={styles.profileRow}>
      <span style={styles.profileLabel}>{label}</span>
      <span style={styles.profileValue}>{value}</span>
    </div>
  );
}/* =========================================================
   STYLES
========================================================= */

const styles = {
  appContainer: {
    minHeight: "100dvh",
    width: "100%",
    background: "#F8FAFC",
    color: "#0F172A",
    fontFamily:
      "Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
  },

  header: {
    minHeight: "72px", padding: "14px 24px", background: "#090D16", color: "#FFFFFF",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: "18px", boxSizing: "border-box",
  },

  logo: { fontWeight: 900, letterSpacing: ".08em", fontSize: "19px" },
  headerSubtitle: { marginTop: "4px", fontSize: "10px", color: "#94A3B8", letterSpacing: ".14em" },
  headerRight: { display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" },

  liveBadge: {
    display: "flex", alignItems: "center", gap: "7px", padding: "7px 10px", borderRadius: "999px",
    background: "rgba(16,185,129,.12)", color: "#34D399", fontSize: "10px", fontWeight: 800, letterSpacing: ".08em",
  },

  offlineBadge: {
    display: "flex", alignItems: "center", gap: "7px", padding: "7px 10px", borderRadius: "999px",
    background: "rgba(148,163,184,.12)", color: "#CBD5E1", fontSize: "10px", fontWeight: 800,
  },

  walletBadge: {
    padding: "7px 10px", borderRadius: "999px", background: "rgba(250,204,21,.14)",
    color: "#FDE68A", fontSize: "10px", fontWeight: 800, letterSpacing: ".06em",
  },

  walletBadgeEmpty: {
    padding: "7px 10px", borderRadius: "999px", background: "rgba(239,68,68,.2)",
    color: "#FECACA", fontSize: "10px", fontWeight: 800, letterSpacing: ".06em",
  },

  liveDot: { width: "7px", height: "7px", borderRadius: "50%", background: "#10B981" },
  offlineDot: { width: "7px", height: "7px", borderRadius: "50%", background: "#94A3B8" },

  userEmail: { fontSize: "12px", color: "#CBD5E1" },

  disconnectButton: {
    border: "1px solid #334155", background: "transparent", color: "#E2E8F0",
    padding: "8px 11px", borderRadius: "8px", cursor: "pointer", fontSize: "10px", fontWeight: 800,
  },

  mainContainer: { width: "100%", maxWidth: "1500px", margin: "0 auto", padding: "20px", boxSizing: "border-box" },

  walletBannerEmpty: {
    background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "16px", padding: "14px 18px",
    marginBottom: "14px", display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: "14px", flexWrap: "wrap",
  },

  walletBannerLow: {
    background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: "16px", padding: "14px 18px",
    marginBottom: "14px", display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: "14px", flexWrap: "wrap",
  },

  walletBannerTitle: { fontWeight: 900, fontSize: "14px", color: "#7F1D1D" },
  walletBannerText: { marginTop: "4px", fontSize: "11px", color: "#64748B", lineHeight: 1.5 },

  noticeInfo: {
    background: "#EFF6FF", border: "1px solid #BFDBFE", color: "#1E40AF", borderRadius: "12px",
    padding: "10px 14px", marginBottom: "14px", fontSize: "12px", fontWeight: 700,
    display: "flex", justifyContent: "space-between", gap: "10px",
  },

  noticeOk: {
    background: "#ECFDF5", border: "1px solid #A7F3D0", color: "#047857", borderRadius: "12px",
    padding: "10px 14px", marginBottom: "14px", fontSize: "12px", fontWeight: 700,
    display: "flex", justifyContent: "space-between", gap: "10px",
  },

  noticeError: {
    background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", borderRadius: "12px",
    padding: "10px 14px", marginBottom: "14px", fontSize: "12px", fontWeight: 700,
    display: "flex", justifyContent: "space-between", gap: "10px",
  },

  noticeClose: { border: "none", background: "transparent", cursor: "pointer", color: "inherit", fontWeight: 900 },

  topupBox: { display: "flex", flexDirection: "column", gap: "8px", minWidth: "220px" },
  topupAmounts: { display: "flex", gap: "6px", flexWrap: "wrap" },

  topupChip: {
    border: "1px solid #CBD5E1", background: "#FFFFFF", color: "#334155", borderRadius: "8px",
    padding: "8px 12px", cursor: "pointer", fontWeight: 900, fontSize: "11px",
  },

  topupChipActive: { background: "#111827", borderColor: "#111827", color: "#FFFFFF" },

  topupButton: {
    border: "none", background: "#10B981", color: "#FFFFFF", padding: "11px 14px",
    borderRadius: "10px", cursor: "pointer", fontWeight: 900, fontSize: "10px", letterSpacing: ".04em",
  },

  walletBig: { fontSize: "30px", fontWeight: 900, color: "#0F172A" },
  walletBigEmpty: { fontSize: "30px", fontWeight: 900, color: "#B91C1C" },

  vehicleStrip: {
    background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: "16px", padding: "16px 18px",
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px",
    marginBottom: "14px", flexWrap: "wrap", boxShadow: "0 6px 22px rgba(15,23,42,.05)",
  },

  vehicleStripTitle: { marginTop: "3px", fontWeight: 800, fontSize: "18px" },
  vehicleStripSub: { marginTop: "4px", color: "#64748B", fontSize: "11px" },

  eyebrow: { color: "#94A3B8", fontSize: "9px", fontWeight: 900, letterSpacing: ".15em" },

  planTripButton: {
    border: "none", background: "#F59E0B", color: "#111827", padding: "10px 14px",
    borderRadius: "999px", cursor: "pointer", fontWeight: 900, fontSize: "10px", letterSpacing: ".04em",
  },

  reserveButton: {
    border: "none", background: "#111827", color: "#FFFFFF", padding: "10px 14px",
    borderRadius: "999px", cursor: "pointer", fontWeight: 900, fontSize: "10px", letterSpacing: ".04em",
  },

  reserveWideButton: {
    width: "100%", marginTop: "8px", border: "1px solid #F59E0B", background: "#FFFBEB",
    color: "#92400E", padding: "11px", borderRadius: "10px", cursor: "pointer",
    fontWeight: 850, fontSize: "10px",
  },

  membershipButton: {
    width: "100%", marginTop: "12px", border: "none", background: "#F59E0B", color: "#111827",
    padding: "11px", borderRadius: "10px", cursor: "pointer", fontWeight: 900, fontSize: "10px",
    letterSpacing: ".04em",
  },

  verifiedBadge: { padding: "8px 11px", borderRadius: "999px", background: "#ECFDF5", color: "#047857", fontSize: "10px", fontWeight: 900 },
  unverifiedBadge: { padding: "8px 11px", borderRadius: "999px", background: "#F1F5F9", color: "#64748B", fontSize: "10px", fontWeight: 900 },

  controlCard: {
    background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: "16px",
    padding: "16px 18px", marginBottom: "14px",
  },

  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "12px" },
  sectionHeading: { marginBottom: "15px" },
  sectionTitle: { fontSize: "17px", fontWeight: 850, marginTop: "4px" },
  locationStatus: { fontSize: "10px", fontWeight: 900, color: "#059669" },

  regionGrid: { display: "grid", gridTemplateColumns: "minmax(220px,1fr) auto", gap: "10px" },

  select: {
    width: "100%", boxSizing: "border-box", border: "1px solid #CBD5E1", borderRadius: "10px",
    padding: "11px 12px", background: "#FFFFFF", color: "#0F172A", fontSize: "13px",
  },

  gpsButton: {
    border: "1px solid #CBD5E1", background: "#FFFFFF", color: "#334155", padding: "10px 14px",
    borderRadius: "10px", cursor: "pointer", fontWeight: 800, fontSize: "11px",
  },

  gpsMessage: { marginTop: "9px", color: "#64748B", fontSize: "11px" },

  metricsGrid: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "12px", marginBottom: "14px" },

  metricCard: { background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: "14px", padding: "15px", minWidth: 0 },

  metricValue: {
    marginTop: "6px", fontSize: "21px", fontWeight: 900, overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap",
  },

  metricSub: { marginTop: "5px", fontSize: "9px", color: "#94A3B8", fontWeight: 800, letterSpacing: ".08em" },

  gridContainer: {
    display: "grid",
    gridTemplateColumns: "minmax(260px,.9fr) minmax(440px,1.7fr) minmax(270px,1fr)",
    gap: "14px", alignItems: "start",
  },

  card: {
    background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: "16px", padding: "16px",
    marginBottom: "14px", boxShadow: "0 5px 18px rgba(15,23,42,.035)",
  },

  vehicleVisual: { display: "flex", alignItems: "center", gap: "12px", padding: "12px", borderRadius: "12px", background: "#F8FAFC" },

  vehicleEmoji: {
    width: "50px", height: "50px", borderRadius: "12px", background: "#FFF7D6",
    display: "flex", alignItems: "center", justifyContent: "center", fontSize: "27px",
  },

  cardTitle: { fontWeight: 850, fontSize: "14px" },
  muted: { color: "#64748B", fontSize: "11px", marginTop: "4px" },

  statusRow: { display: "flex", gap: "7px", flexWrap: "wrap", marginTop: "12px" },

  smallGreenBadge: { background: "#ECFDF5", color: "#047857", padding: "5px 7px", borderRadius: "6px", fontSize: "8px", fontWeight: 900 },
  smallGrayBadge: { background: "#F1F5F9", color: "#64748B", padding: "5px 7px", borderRadius: "6px", fontSize: "8px", fontWeight: 900 },

  smartcarButton: {
    width: "100%", marginTop: "12px", border: "none", background: "#F59E0B", color: "#FFFFFF",
    padding: "11px", borderRadius: "10px", cursor: "pointer", fontWeight: 850, fontSize: "10px",
  },

  smartcarRow: { display: "flex", gap: "7px", marginTop: "12px" },

  smartcarButtonSecondary: {
    flex: 1, border: "1px solid #CBD5E1", background: "#FFFFFF", color: "#334155",
    padding: "10px", borderRadius: "9px", cursor: "pointer", fontWeight: 800, fontSize: "10px",
  },

  smartcarButtonGhost: {
    flex: 1, border: "1px solid #FCA5A5", background: "#FFFFFF", color: "#B91C1C",
    padding: "10px", borderRadius: "9px", cursor: "pointer", fontWeight: 800, fontSize: "10px",
  },

  guidanceName: { fontWeight: 900, fontSize: "16px" },
  guidanceAddress: { color: "#64748B", fontSize: "11px", marginTop: "5px" },

  guidanceGrid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px", marginTop: "14px" },

  miniStat: { background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "10px", padding: "9px" },
  miniLabel: { color: "#94A3B8", fontSize: "8px", fontWeight: 900 },
  miniValue: { marginTop: "4px", fontSize: "11px", fontWeight: 850 },

  priceGuidance: {
    marginTop: "10px", padding: "8px 9px", borderRadius: "9px", background: "#FFFBEB",
    color: "#92400E", fontSize: "10px", fontWeight: 800,
  },

  liveAvailabilityGuidance: {
    marginTop: "7px", padding: "8px 9px", borderRadius: "9px", background: "#ECFDF5",
    color: "#047857", fontSize: "10px", fontWeight: 800,
  },

  navigationButton: {
    width: "100%", marginTop: "12px", border: "none", background: "#111827", color: "#FFFFFF",
    padding: "11px", borderRadius: "10px", cursor: "pointer", fontWeight: 850, fontSize: "10px",
  },

  emptyState: {
    background: "#F8FAFC", border: "1px dashed #CBD5E1", borderRadius: "11px", padding: "20px",
    textAlign: "center", color: "#64748B", fontSize: "12px",
  },

  chatBox: {
    minHeight: "210px", maxHeight: "340px", overflowY: "auto", background: "#F8FAFC",
    border: "1px solid #E2E8F0", borderRadius: "11px", padding: "10px",
  },

  chatEmpty: { color: "#64748B", fontSize: "11px", lineHeight: 1.6, padding: "10px" },

  userMessage: {
    background: "#111827", color: "#FFFFFF", padding: "9px 10px", borderRadius: "10px 10px 2px 10px",
    marginBottom: "8px", fontSize: "11px", lineHeight: 1.5,
  },

  aiMessage: {
    background: "#FFFFFF", border: "1px solid #E2E8F0", color: "#334155", padding: "9px 10px",
    borderRadius: "10px 10px 10px 2px", marginBottom: "8px", fontSize: "11px", lineHeight: 1.5,
  },

  messageLabel: { fontSize: "8px", fontWeight: 900, color: "#94A3B8", marginBottom: "4px", letterSpacing: ".08em" },

  chatForm: { display: "flex", gap: "7px", marginTop: "8px" },

  chatInput: { flex: 1, minWidth: 0, border: "1px solid #CBD5E1", borderRadius: "9px", padding: "10px", fontSize: "11px" },

  sendButton: {
    border: "none", borderRadius: "9px", background: "#F59E0B", color: "#FFFFFF",
    padding: "0 13px", cursor: "pointer", fontWeight: 900, fontSize: "10px",
  },

  mapHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "12px" },

  refreshBadge: { padding: "7px 9px", borderRadius: "8px", background: "#F8FAFC", color: "#64748B", fontSize: "9px", fontWeight: 900 },

  errorBanner: {
    background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", borderRadius: "10px",
    padding: "9px 10px", fontSize: "10px", marginBottom: "10px",
  },

  mapStage: {
    position: "relative", width: "100%", height: "460px", borderRadius: "13px",
    overflow: "hidden", border: "1px solid #CBD5E1", background: "#E2E8F0",
  },

  map: { width: "100%", height: "100%" },

  mapToolbar: { position: "absolute", top: "12px", left: "12px", zIndex: 1000, display: "flex", gap: "7px", flexWrap: "wrap" },

  mapToolButton: {
    border: "1px solid rgba(15,23,42,.1)", background: "rgba(255,255,255,.95)", color: "#0F172A",
    padding: "8px 10px", borderRadius: "8px", cursor: "pointer", fontWeight: 800, fontSize: "9px",
    boxShadow: "0 3px 12px rgba(15,23,42,.15)",
  },

  loadingOverlay: {
    position: "absolute", left: "50%", bottom: "12px", transform: "translateX(-50%)", zIndex: 1000,
    background: "rgba(15,23,42,.92)", color: "#FFFFFF", borderRadius: "999px", padding: "8px 12px",
    fontSize: "9px", fontWeight: 900, display: "flex", alignItems: "center", gap: "7px",
  },

  spinner: {
    width: "10px", height: "10px", border: "2px solid rgba(255,255,255,.25)",
    borderTop: "2px solid #FACC15", borderRadius: "50%", animation: "spin .8s linear infinite",
  },

  nodeCount: { fontSize: "9px", color: "#64748B", fontWeight: 900 },

  stationSearch: {
    width: "100%", boxSizing: "border-box", border: "1px solid #CBD5E1", borderRadius: "9px",
    padding: "10px", fontSize: "11px", marginBottom: "8px",
  },

  filterRow: { display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "10px" },

  filterButton: {
    border: "1px solid #E2E8F0", background: "#FFFFFF", color: "#64748B", borderRadius: "7px",
    padding: "6px 8px", cursor: "pointer", fontSize: "8px", fontWeight: 900,
  },

  filterButtonActive: { background: "#111827", color: "#FFFFFF", borderColor: "#111827" },

  stationList: { maxHeight: "430px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "7px" },

  stationRow: {
    width: "100%", textAlign: "left", border: "1px solid #E2E8F0", background: "#FFFFFF",
    borderRadius: "11px", padding: "10px", display: "grid",
    gridTemplateColumns: "78px minmax(0,1fr) 100px", gap: "10px", alignItems: "center",
    cursor: "pointer", transition: "all .15s ease",
  },

  stationRowSelected: { border: "1px solid #F59E0B", boxShadow: "0 0 0 2px rgba(245,158,11,.1)" },

  stationStatusColumn: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "5px" },

  statusDot: { width: "9px", height: "9px", borderRadius: "50%" },
  statusText: { fontSize: "7px", fontWeight: 900, letterSpacing: ".05em" },

  stationMain: { minWidth: 0 },

  stationName: { fontWeight: 850, fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },

  stationMeta: { color: "#64748B", fontSize: "9px", marginTop: "2px" },

  stationAddress: {
    color: "#94A3B8", fontSize: "9px", marginTop: "2px", overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap",
  },

  availabilityBadge: {
    display: "inline-block", marginTop: "5px", padding: "3px 5px", borderRadius: "5px",
    background: "#ECFDF5", color: "#047857", fontSize: "7px", fontWeight: 900,
  },

  stationRight: { textAlign: "right" },
  stationDistance: { fontSize: "9px", fontWeight: 900, color: "#0F172A" },
  stationPower: { fontSize: "9px", color: "#64748B", marginTop: "3px" },
  stationPrice: { fontSize: "9px", color: "#B45309", fontWeight: 850, marginTop: "3px" },

  emptyStations: { padding: "35px 15px", textAlign: "center", color: "#64748B", fontSize: "11px" },

  profileAvatar: {
    width: "62px", height: "62px", borderRadius: "18px", background: "#FFF7D6",
    display: "flex", alignItems: "center", justifyContent: "center", fontSize: "28px", marginBottom: "12px",
  },

  profileName: { fontWeight: 900, fontSize: "16px" },
  profileEmail: { color: "#64748B", fontSize: "11px", marginTop: "4px", wordBreak: "break-word" },
  profileDivider: { height: "1px", background: "#E2E8F0", margin: "15px 0" },

  profileRow: {
    display: "flex", justifyContent: "space-between", gap: "10px", padding: "9px 0",
    borderBottom: "1px solid #F1F5F9",
  },

  profileLabel: { color: "#94A3B8", fontSize: "8px", fontWeight: 900 },
  profileValue: { textAlign: "right", fontSize: "10px", fontWeight: 800, maxWidth: "60%" },

  profileNote: {
    marginTop: "15px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "10px",
    padding: "10px", color: "#64748B", fontSize: "9px", lineHeight: 1.5,
  },
};
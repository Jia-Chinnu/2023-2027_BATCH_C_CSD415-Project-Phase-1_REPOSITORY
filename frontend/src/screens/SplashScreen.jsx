import { useEffect, useState } from "react";

export default function SplashScreen({ onDone }) {
  const [status, setStatus] = useState("Initializing TrustCharge…");
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) setIsLoaded(true);
    }, 150);

    const stepTimer = setTimeout(() => {
      if (!cancelled) setStatus("Calibrating grid & networks…");
    }, 1000);

    const splashDurationSeconds = 2.5;
    const longTimeout = setTimeout(() => {
      if (!cancelled) onDone();
    }, splashDurationSeconds * 1000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(stepTimer);
      clearTimeout(longTimeout);
    };
  }, [onDone]);

  return (
    <div style={styles.container}>
      <div
        style={{
          ...styles.contentBox,
          opacity: isLoaded ? 1 : 0,
          transform: isLoaded ? "scale(1) translateY(0)" : "scale(0.9) translateY(12px)",
        }}
      >
        {/* Multi-Layered Glowing Rings Logo Container */}
        <div style={styles.ringContainer}>
          {/* Outer Soft Amber Glow Aura */}
          <div style={styles.outerGlow} />

          {/* Ring 1: Outer Dashed Golden Ring (Spinning Slow Clockwise) */}
          <div style={{ ...styles.ring, ...styles.spinSlow, border: "1.5px dashed rgba(251, 191, 36, 0.4)" }} />

          {/* Ring 2: Fiery Orange Track with Orbiting Light Dots (Spinning Counter-Clockwise) */}
          <div style={{ ...styles.ring, inset: "22px", ...styles.spinReverse, border: "2px solid rgba(249, 115, 22, 0.5)" }}>
            <span style={{ ...styles.orbitDotTop, background: "#FBBF24", boxShadow: "0 0 10px #FBBF24" }} />
            <span style={{ ...styles.orbitDotBottom, background: "#FFFFFF", boxShadow: "0 0 10px #FFFFFF" }} />
          </div>

          {/* Ring 3: Vibrant Amber Gradient Track (Spinning Fast Clockwise) */}
          <div style={{ ...styles.ring, inset: "52px", ...styles.spinFast, border: "6px solid rgba(245, 158, 11, 0.2)", borderTopColor: "#F59E0B", borderRightColor: "#EA580C" }} />

          {/* Ring 4: Inner Bright Yellow Core Ring (Spinning Counter-Clockwise) */}
          <div style={{ ...styles.ring, inset: "84px", ...styles.spinMedium, border: "3px solid rgba(254, 240, 138, 0.3)", borderLeftColor: "#FEF08A" }}>
            <span style={{ ...styles.orbitDotInner, background: "#FBBF24" }} />
          </div>

          {/* Centerpiece Core Badge with Lightning Bolt */}
          <div style={styles.coreBadge}>
            <div style={styles.coreShine} />
            <span style={styles.bolt}>⚡</span>
          </div>
        </div>

        {/* Brand Title and Status */}
        <div style={{ textAlign: "center", zIndex: 10, marginTop: "32px" }}>
          <h1 style={styles.title}>
            Trust<span style={{ color: "#FBBF24" }}>Charge</span>
          </h1>
          <p style={styles.statusText}>{status}</p>
        </div>
      </div>

      {/* Embedded Smooth CSS Rotations & Glow Keyframes */}
      <style>{`
        @keyframes spinClockwise { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes spinCounter { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
        @keyframes auraPulse { 
          0%, 100% { transform: scale(0.95); opacity: 0.5; } 
          50% { transform: scale(1.05); opacity: 0.9; } 
        }
      `}</style>
    </div>
  );
}

const styles = {
  container: {
    height: "100vh",
    width: "100vw",
    backgroundColor: "#121214", // Deep obsidian dark background that makes yellow/orange rings pop brilliantly
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    userSelect: "none",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  contentBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.7s cubic-bezier(0.16, 1, 0.3, 1)",
  },
  ringContainer: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "260px",
    width: "260px",
  },
  outerGlow: {
    position: "absolute",
    inset: "-10px",
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(245, 158, 11, 0.25) 0%, rgba(234, 88, 12, 0.05) 70%, transparent 100%)",
    animation: "auraPulse 3s ease-in-out infinite",
    zIndex: 1,
  },
  ring: {
    position: "absolute",
    inset: "0px",
    borderRadius: "50%",
    zIndex: 2,
  },
  spinSlow: { animation: "spinClockwise 28s linear infinite" },
  spinReverse: { animation: "spinCounter 18s linear infinite" },
  spinFast: { animation: "spinClockwise 10s linear infinite" },
  spinMedium: { animation: "spinCounter 14s linear infinite" },
  orbitDotTop: {
    position: "absolute",
    top: "-5px",
    left: "50%",
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    transform: "translateX(-50%)",
  },
  orbitDotBottom: {
    position: "absolute",
    bottom: "-5px",
    right: "30px",
    width: "8px",
    height: "8px",
    borderRadius: "50%",
  },
  orbitDotInner: {
    position: "absolute",
    top: "10px",
    right: "-4px",
    width: "7px",
    height: "7px",
    borderRadius: "50%",
  },
  coreBadge: {
    position: "absolute",
    width: "84px",
    height: "84px",
    borderRadius: "26px",
    background: "linear-gradient(135deg, #F59E0B 0%, #D97706 50%, #C2410C 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 15px 35px rgba(245, 158, 11, 0.4), inset 0 2px 4px rgba(255, 255, 255, 0.4)",
    border: "1.5px solid rgba(255, 255, 255, 0.25)",
    zIndex: 5,
  },
  coreShine: {
    position: "absolute",
    inset: "3px",
    borderRadius: "23px",
    background: "radial-gradient(circle at top, rgba(255, 255, 255, 0.35) 0%, transparent 70%)",
    pointerEvents: "none",
  },
  bolt: {
    color: "#FFFFFF",
    fontSize: "38px",
    fontWeight: "900",
    filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.3))",
    zIndex: 6,
  },
  title: {
    fontSize: "34px",
    fontWeight: "800",
    letterSpacing: "-0.03em",
    color: "#FFFFFF",
    margin: 0,
  },
  statusText: {
    fontSize: "11px",
    fontWeight: "600",
    color: "#FBBF24",
    marginTop: "8px",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
  },
};
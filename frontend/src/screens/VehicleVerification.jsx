import React, { useEffect, useRef } from "react";

export default function VehicleVerification({
  plateInput,
  setPlateInput,
  onVerifySubmit,
  loading,
  errorMessage,
  currentUser,
}) {
  const inputRef = useRef(null);

  // Automatically focus the plate field when the page opens
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 250);

    return () => clearTimeout(timer);
  }, []);

  const handlePlateChange = (e) => {
    // Dutch plates should be sent without unnecessary spaces
    const value = e.target.value
      .toUpperCase()
      .replace(/\s+/g, "")
      .slice(0, 8);

    setPlateInput(value);
  };

  return (
    <div style={styles.pageWrapper}>
      {/* Decorative background elements */}
      <div style={styles.backgroundGlowOne} />
      <div style={styles.backgroundGlowTwo} />

      <div style={styles.cardBox}>
        {/* =====================================================
            BRAND
        ====================================================== */}
        <div style={styles.headerGroup}>
          <div style={styles.coreBadge}>
            <span style={styles.badgeBolt}>⚡</span>
          </div>

          <div>
            <h1 style={styles.brandTitle}>
              Trust<span style={styles.brandAccent}>Charge</span>
            </h1>

            <div style={styles.brandTag}>
              SMART EV MOBILITY
            </div>
          </div>
        </div>

        {/* =====================================================
            STATUS INDICATOR
        ====================================================== */}
        <div style={styles.liveIndicator}>
          <span style={styles.liveDot} />
          <span>RDW LIVE REGISTRY</span>
        </div>

        {/* =====================================================
            HEADING
        ====================================================== */}
        <h2 style={styles.cardHeading}>
          Vehicle Registration Check
        </h2>

        <p style={styles.cardSub}>
          {currentUser?.email ? (
            <>
              Hello,{" "}
              <strong style={styles.emailText}>
                {currentUser.email}
              </strong>
              .
              <br />
            </>
          ) : null}

          Enter your Dutch license plate to verify your vehicle
          directly against the official RDW vehicle registry.
        </p>

        {/* =====================================================
            FORM
        ====================================================== */}
        <form onSubmit={onVerifySubmit}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>
              License Plate Number
            </label>

            {/* =================================================
                DUTCH PLATE
            ================================================== */}
            <div
              style={{
                ...styles.dutchPlateContainer,
                ...(loading ? styles.plateLoading : {}),
              }}
            >
              {/* Dutch EU strip */}
              <div style={styles.euStrip}>
                <div style={styles.euStars}>★</div>
                <div style={styles.euText}>NL</div>
              </div>

              <input
                ref={inputRef}
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck="false"
                placeholder="XX-999-X"
                value={plateInput}
                onChange={handlePlateChange}
                disabled={loading}
                required
                aria-label="Dutch license plate number"
                style={styles.plateInput}
              />

              {/* Small plate shine */}
              <div style={styles.plateShine} />
            </div>

            <div style={styles.inputHint}>
              Example format: <strong>XX-999-X</strong>
            </div>
          </div>

          {/* =====================================================
              VERIFY BUTTON
          ====================================================== */}
          <button
            type="submit"
            disabled={loading || !plateInput?.trim()}
            style={{
              ...styles.successButton,
              ...(loading ? styles.buttonLoading : {}),
              ...(!plateInput?.trim()
                ? styles.buttonDisabled
                : {}),
            }}
          >
            {loading ? (
              <span style={styles.loadingContent}>
                <span style={styles.spinner} />
                Validating Live RDW Data...
              </span>
            ) : (
              <span style={styles.buttonContent}>
                <span>✓</span>
                Verify Vehicle & Continue
                <span style={styles.arrow}>→</span>
              </span>
            )}
          </button>

          {/* =====================================================
              ERROR
          ====================================================== */}
          {errorMessage && (
            <div style={styles.errorBox}>
              <div style={styles.errorIcon}>!</div>

              <div>
                <div style={styles.errorTitle}>
                  Vehicle verification failed
                </div>

                <div style={styles.errorText}>
                  {errorMessage}
                </div>
              </div>
            </div>
          )}
        </form>

        {/* =====================================================
            TRUST / DATA INFORMATION
        ====================================================== */}
        <div style={styles.infoBox}>
          <div style={styles.infoIcon}>✓</div>

          <div style={styles.infoText}>
            <strong>Real vehicle verification</strong>
            <br />
            TrustCharge checks the registration against RDW
            data. No demo vehicles are generated.
          </div>
        </div>

        {/* =====================================================
            FOOTER
        ====================================================== */}
        <div style={styles.footer}>
          <span>TRUSTCHARGE</span>
          <span style={styles.footerDot}>•</span>
          <span>RDW CONNECTED</span>
        </div>
      </div>
    </div>
  );
}

const styles = {
  /* =========================================================
     PAGE
  ========================================================== */

  pageWrapper: {
    position: "relative",
    minHeight: "100vh",
    width: "100%",
    background:
      "linear-gradient(135deg, #FBF8F3 0%, #FFFDF9 45%, #FFF7E8 100%)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    fontFamily:
      "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    padding: "24px",
    boxSizing: "border-box",
    overflow: "hidden",
  },

  backgroundGlowOne: {
    position: "absolute",
    width: "420px",
    height: "420px",
    borderRadius: "50%",
    background:
      "radial-gradient(circle, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0) 70%)",
    top: "-180px",
    right: "-160px",
    pointerEvents: "none",
  },

  backgroundGlowTwo: {
    position: "absolute",
    width: "360px",
    height: "360px",
    borderRadius: "50%",
    background:
      "radial-gradient(circle, rgba(217,119,6,0.08) 0%, rgba(217,119,6,0) 70%)",
    bottom: "-180px",
    left: "-140px",
    pointerEvents: "none",
  },

  /* =========================================================
     CARD
  ========================================================== */

  cardBox: {
    position: "relative",
    zIndex: 2,
    backgroundColor: "#FFFFFF",
    padding: "34px",
    borderRadius: "24px",
    boxShadow:
      "0 25px 70px rgba(120,70,10,0.10), 0 4px 18px rgba(120,70,10,0.05)",
    border: "1px solid rgba(245,158,11,0.16)",
    width: "100%",
    maxWidth: "470px",
    boxSizing: "border-box",
  },

  /* =========================================================
     BRAND
  ========================================================== */

  headerGroup: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    marginBottom: "18px",
  },

  coreBadge: {
    width: "44px",
    height: "44px",
    borderRadius: "13px",
    background:
      "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
    color: "#FFFFFF",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "900",
    fontSize: "21px",
    boxShadow:
      "0 8px 22px rgba(217,119,6,0.25)",
    flexShrink: 0,
  },

  badgeBolt: {
    transform: "translateY(-1px)",
  },

  brandTitle: {
    margin: 0,
    fontSize: "23px",
    lineHeight: "1",
    fontWeight: "900",
    letterSpacing: "-0.6px",
    color: "#292524",
  },

  brandAccent: {
    color: "#D97706",
  },

  brandTag: {
    marginTop: "5px",
    fontSize: "8px",
    fontWeight: "800",
    letterSpacing: "1.8px",
    color: "#A8A29E",
  },

  /* =========================================================
     LIVE STATUS
  ========================================================== */

  liveIndicator: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "7px",
    width: "fit-content",
    margin: "0 auto 18px",
    padding: "6px 10px",
    borderRadius: "999px",
    backgroundColor: "#FFF8E7",
    border: "1px solid rgba(245,158,11,0.20)",
    color: "#A16207",
    fontSize: "9px",
    fontWeight: "800",
    letterSpacing: "0.8px",
  },

  liveDot: {
    width: "7px",
    height: "7px",
    borderRadius: "50%",
    backgroundColor: "#16A34A",
    boxShadow: "0 0 0 4px rgba(22,163,74,0.10)",
  },

  /* =========================================================
     HEADING
  ========================================================== */

  cardHeading: {
    fontSize: "21px",
    fontWeight: "850",
    color: "#1C1917",
    margin: "0 0 8px",
    textAlign: "center",
    letterSpacing: "-0.3px",
  },

  cardSub: {
    fontSize: "13px",
    color: "#78716C",
    margin: "0 auto 25px",
    textAlign: "center",
    lineHeight: "1.55",
    maxWidth: "390px",
  },

  emailText: {
    color: "#57534E",
    fontWeight: "700",
  },

  /* =========================================================
     INPUT
  ========================================================== */

  inputGroup: {
    marginBottom: "18px",
  },

  label: {
    display: "block",
    fontSize: "11px",
    fontWeight: "800",
    color: "#57534E",
    marginBottom: "8px",
    textTransform: "uppercase",
    letterSpacing: "0.8px",
  },

  dutchPlateContainer: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    minHeight: "72px",
    background:
      "linear-gradient(180deg, #FFE04A 0%, #FFCC00 100%)",
    border: "3px solid #1C1917",
    borderRadius: "12px",
    padding: "7px 12px 7px 7px",
    boxSizing: "border-box",
    boxShadow:
      "inset 0 2px 5px rgba(255,255,255,0.45), inset 0 -3px 7px rgba(0,0,0,0.12), 0 5px 12px rgba(0,0,0,0.08)",
    overflow: "hidden",
    transition:
      "transform 0.2s ease, box-shadow 0.2s ease",
  },

  plateLoading: {
    opacity: 0.75,
  },

  euStrip: {
    width: "32px",
    alignSelf: "stretch",
    borderRadius: "5px",
    backgroundColor: "#1452A2",
    color: "#FFFFFF",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginRight: "8px",
    boxShadow:
      "inset 1px 0 2px rgba(255,255,255,0.15)",
  },

  euStars: {
    fontSize: "9px",
    lineHeight: "10px",
    letterSpacing: "1px",
  },

  euText: {
    fontSize: "10px",
    lineHeight: "12px",
    fontWeight: "900",
    letterSpacing: "0.5px",
  },

  plateInput: {
    position: "relative",
    zIndex: 2,
    backgroundColor: "transparent",
    border: "none",
    textAlign: "center",
    fontSize: "27px",
    fontWeight: "950",
    letterSpacing: "4px",
    width: "100%",
    outline: "none",
    textTransform: "uppercase",
    fontFamily:
      "'Arial Black', Impact, monospace",
    color: "#111827",
    minWidth: 0,
  },

  plateShine: {
    position: "absolute",
    left: "45px",
    right: "10px",
    top: "4px",
    height: "13px",
    borderRadius: "20px",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0))",
    pointerEvents: "none",
  },

  inputHint: {
    marginTop: "7px",
    fontSize: "10px",
    color: "#A8A29E",
    textAlign: "right",
  },

  /* =========================================================
     BUTTON
  ========================================================== */

  successButton: {
    width: "100%",
    minHeight: "50px",
    padding: "13px 16px",
    background:
      "linear-gradient(135deg, #D97706 0%, #EA8C08 100%)",
    color: "#FFFFFF",
    border: "none",
    borderRadius: "12px",
    fontWeight: "850",
    fontSize: "14px",
    cursor: "pointer",
    marginTop: "4px",
    boxShadow:
      "0 8px 20px rgba(217,119,6,0.24)",
    transition:
      "transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease",
  },

  buttonLoading: {
    cursor: "wait",
    opacity: 0.88,
  },

  buttonDisabled: {
    cursor: "not-allowed",
    opacity: 0.55,
    boxShadow: "none",
  },

  buttonContent: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "9px",
  },

  arrow: {
    fontSize: "17px",
    marginLeft: "2px",
  },

  loadingContent: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
  },

  spinner: {
    width: "15px",
    height: "15px",
    border: "2px solid rgba(255,255,255,0.35)",
    borderTopColor: "#FFFFFF",
    borderRadius: "50%",
    display: "inline-block",
    animation: "trustcharge-spin 0.8s linear infinite",
  },

  /* =========================================================
     ERROR
  ========================================================== */

  errorBox: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
    marginTop: "14px",
    padding: "12px",
    borderRadius: "10px",
    backgroundColor: "#FEF2F2",
    border: "1px solid #FECACA",
  },

  errorIcon: {
    width: "22px",
    height: "22px",
    borderRadius: "50%",
    backgroundColor: "#DC2626",
    color: "#FFFFFF",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "12px",
    fontWeight: "900",
    flexShrink: 0,
  },

  errorTitle: {
    color: "#991B1B",
    fontSize: "11px",
    fontWeight: "800",
    marginBottom: "2px",
  },

  errorText: {
    color: "#B91C1C",
    fontSize: "11px",
    lineHeight: "1.4",
    fontWeight: "600",
  },

  /* =========================================================
     INFO
  ========================================================== */

  infoBox: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
    marginTop: "18px",
    padding: "12px",
    borderRadius: "10px",
    backgroundColor: "#FFFBEB",
    border: "1px solid rgba(245,158,11,0.18)",
  },

  infoIcon: {
    width: "21px",
    height: "21px",
    borderRadius: "50%",
    backgroundColor: "#F59E0B",
    color: "#FFFFFF",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "11px",
    fontWeight: "900",
    flexShrink: 0,
  },

  infoText: {
    fontSize: "10px",
    color: "#78716C",
    lineHeight: "1.45",
  },

  /* =========================================================
     FOOTER
  ========================================================== */

  footer: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: "7px",
    marginTop: "20px",
    fontSize: "8px",
    fontWeight: "800",
    letterSpacing: "1.2px",
    color: "#A8A29E",
  },

  footerDot: {
    color: "#F59E0B",
  },
};
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";

/* =========================================================
   TRUSTCHARGE MEMBERSHIP & PAYMENT
   ---------------------------------------------------------
   - ONLY PAID PLANS:
       • TrustCharge Plus
       • TrustCharge Pro Priority Pass
   - Standard/free membership has been completely removed
     from this frontend.
   - Plans are loaded from:
       GET /api/payments/plans
   - Any STANDARD plan accidentally returned by the backend
     is filtered out.
   - Mollie handles payment checkout.
   - Works standalone or embedded inside dashboard.
========================================================= */

const FALLBACK_PLANS = [
  {
    id: "PLUS",
    label: "TrustCharge Plus",
    price: "4.99",
    credit: 10,
    benefits: {
      reservationFeeDiscountPct: 50,
      energyDiscountPct: 5,
      maxActiveReservations: 2,
      maxAdvanceHours: 72,
      maxDurationMin: 90,
      freeCancelMinutes: 30,
    },
  },
  {
    id: "PRO",
    label: "TrustCharge Pro Priority Pass",
    price: "9.99",
    credit: 25,
    benefits: {
      reservationFeeDiscountPct: 100,
      energyDiscountPct: 12,
      maxActiveReservations: 4,
      maxAdvanceHours: 168,
      maxDurationMin: 120,
      freeCancelMinutes: 10,
    },
  },
];

/* =========================================================
   HELPERS
========================================================= */

function hoursLabel(h) {
  return h % 24 === 0
    ? `${h / 24} day${h / 24 === 1 ? "" : "s"} ahead`
    : `${h} h ahead`;
}

function buildRows(feePer30) {
  return [
    {
      label: "Port reservation fee",
      value: (p, b) =>
        b.reservationFeeDiscountPct >= 100
          ? "Free"
          : b.reservationFeeDiscountPct > 0
          ? `€${(
              feePer30 *
              (1 - b.reservationFeeDiscountPct / 100)
            ).toFixed(2)} / 30 min (-${b.reservationFeeDiscountPct}%)`
          : `€${feePer30.toFixed(2)} / 30 min`,
    },
    {
      label: "Discount on charging energy",
      value: (p, b) =>
        b.energyDiscountPct > 0
          ? `${b.energyDiscountPct}% off every kWh`
          : "—",
    },
    {
      label: "Book ahead",
      value: (p, b) => hoursLabel(b.maxAdvanceHours),
    },
    {
      label: "Active reservations at once",
      value: (p, b) => String(b.maxActiveReservations),
    },
    {
      label: "Longest reservation",
      value: (p, b) => `${b.maxDurationMin} min`,
    },
    {
      label: "Free cancellation until",
      value: (p, b) => `${b.freeCancelMinutes} min before start`,
    },
    {
      label: "Wallet credit included",
      value: (p) =>
        Number(p.credit) > 0
          ? `€${Number(p.credit).toFixed(2)} per period`
          : "—",
    },
  ];
}

/* =========================================================
   THEMES
========================================================= */

const THEMES = {
  dark: {
    page: "#090D16",
    card: "#0f172a",
    cardBorder: "#334155",
    title: "#FFFFFF",
    text: "#cbd5e1",
    muted: "#94a3b8",
    tile: "#1e293b",
    tileBorder: "#334155",
    accent: "#F59E0B",
    accentSoft: "rgba(245,158,11,0.10)",
    tableLine: "#1e293b",
    ghost: "#334155",
    ghostText: "#FFFFFF",
    shadow: "0 20px 50px rgba(0,0,0,0.6)",
  },

  light: {
    page: "transparent",
    card: "#FFFFFF",
    cardBorder: "#E2E8F0",
    title: "#0F172A",
    text: "#334155",
    muted: "#64748B",
    tile: "#F8FAFC",
    tileBorder: "#E2E8F0",
    accent: "#D97706",
    accentSoft: "rgba(245,158,11,0.10)",
    tableLine: "#F1F5F9",
    ghost: "#F1F5F9",
    ghostText: "#334155",
    shadow: "0 5px 18px rgba(15,23,42,.05)",
  },
};

/* =========================================================
   COMPONENT
========================================================= */

export default function PaymentIntegration({
  currentUser,
  apiBaseUrl,
  onBack,
  embedded = false,
  onMembershipChange,
}) {
  const t = embedded ? THEMES.light : THEMES.dark;

  const [plans, setPlans] = useState(FALLBACK_PLANS);
  const [feePer30, setFeePer30] = useState(1);

  // Default to PRO as requested previously.
  const [selectedPlan, setSelectedPlan] = useState("PRO");

  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const firebaseUid =
    currentUser?.firebaseUid || currentUser?.uid;

  /* =========================================================
     LOAD PAID PLANS
  ========================================================= */

  useEffect(() => {
    let cancelled = false;

    axios
      .get(`${apiBaseUrl}/api/payments/plans`)
      .then((res) => {
        if (cancelled || !Array.isArray(res.data?.plans)) {
          return;
        }

        // IMPORTANT:
        // Never display STANDARD even if the backend still
        // returns it.
        const paidPlans = res.data.plans.filter(
          (plan) => plan?.id !== "STANDARD"
        );

        if (paidPlans.length > 0) {
          setPlans(paidPlans);

          // Keep PRO selected if it exists.
          if (paidPlans.some((plan) => plan.id === "PRO")) {
            setSelectedPlan("PRO");
          } else {
            setSelectedPlan(paidPlans[0].id);
          }
        }

        if (
          Number.isFinite(
            Number(res.data.reservationFeePer30Min)
          )
        ) {
          setFeePer30(
            Number(res.data.reservationFeePer30Min)
          );
        }
      })
      .catch(() => {
        // Keep paid fallback plans.
        setPlans(FALLBACK_PLANS);
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  /* =========================================================
     LOAD WALLET / MEMBERSHIP STATUS
  ========================================================= */

  const loadWallet = useCallback(async () => {
    if (!firebaseUid) return;

    try {
      const res = await axios.get(
        `${apiBaseUrl}/api/payments/status/${firebaseUid}`
      );

      if (res.data?.success) {
        setWallet(res.data.wallet || null);
      }
    } catch {
      // Non-critical.
    }
  }, [apiBaseUrl, firebaseUid]);

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  /* =========================================================
     ACTIVE PLAN
  ========================================================= */

  const activePlanId = wallet?.activePlan || null;

  const activePlan = activePlanId
    ? plans.find((p) => p.id === activePlanId) || null
    : null;

  const chosen =
    plans.find((p) => p.id === selectedPlan) ||
    plans[0] ||
    null;

  const rows = useMemo(
    () => buildRows(feePer30),
    [feePer30]
  );

  /* =========================================================
     EXPIRY
  ========================================================= */

  const expiresLabel = wallet?.planExpiresAt
    ? new Date(wallet.planExpiresAt).toLocaleDateString(
        [],
        {
          day: "numeric",
          month: "short",
          year: "numeric",
        }
      )
    : null;

  /* =========================================================
     EXAMPLE SAVING
  ========================================================= */

  const exampleKwh = 25;
  const examplePrice = 0.42;

  const exampleSaving = chosen
    ? (
        (exampleKwh *
          examplePrice *
          Number(
            chosen.benefits?.energyDiscountPct || 0
          )) /
        100
      ).toFixed(2)
    : "0.00";

  /* =========================================================
     MOLLIE CHECKOUT
  ========================================================= */

  const handleMollieCheckout = async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      if (!firebaseUid) {
        setErrorMessage(
          "Your session is missing an account ID. Please sign in again."
        );
        return;
      }

      if (!chosen) {
        setErrorMessage(
          "Please select a membership plan."
        );
        return;
      }

      // Safety guard:
      // Standard must never reach Mollie.
      if (chosen.id === "STANDARD") {
        setErrorMessage(
          "This membership is no longer available."
        );
        return;
      }

      const returnUrl = `${window.location.origin}${window.location.pathname}`;

      const response = await axios.post(
        `${apiBaseUrl}/api/payments/create-checkout`,
        {
          firebaseUid,
          planType: chosen.id,
          email: currentUser?.email,
          returnUrl,
        }
      );

      if (
        response.data?.success &&
        response.data?.checkoutUrl
      ) {
        if (onMembershipChange) {
          onMembershipChange();
        }

        window.location.href =
          response.data.checkoutUrl;

        return;
      }

      setErrorMessage(
        "Failed to initialize Mollie checkout session."
      );
    } catch (err) {
      console.error("Payment error:", err);

      setErrorMessage(
        err.response?.data?.detail ||
          err.response?.data?.error ||
          "Could not connect to payment gateway."
      );
    } finally {
      setLoading(false);
    }
  };

  /* =========================================================
     BUTTON LABEL
  ========================================================= */

  const payLabel = loading
    ? "Redirecting to Mollie..."
    : chosen?.id === activePlanId
    ? `Renew ${chosen.label} (€${chosen.price}) →`
    : `Get ${chosen?.label || "Membership"} (€${
        chosen?.price || "0.00"
      }) →`;

  /* =========================================================
     PLAN SWITCHING
  ========================================================= */

  const switching =
    Boolean(activePlanId) &&
    chosen?.id !== activePlanId;

  /* =========================================================
     OUTER CONTAINER
  ========================================================= */

  const outer = embedded
    ? {
        width: "100%",
        boxSizing: "border-box",
      }
    : {
        minHeight: "100vh",
        width: "100vw",
        backgroundColor: t.page,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        boxSizing: "border-box",
      };

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <div
      style={{
        ...outer,
        fontFamily:
          "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: embedded ? "980px" : "920px",
          margin: embedded ? "0 auto" : 0,
          backgroundColor: t.card,
          border: `1px solid ${t.cardBorder}`,
          borderRadius: "20px",
          padding: "28px",
          boxShadow: t.shadow,
          boxSizing: "border-box",
        }}
      >
        {/* =================================================
            HEADER
        ================================================= */}

        <div
          style={{
            fontSize: "11px",
            fontWeight: 800,
            color: t.accent,
            letterSpacing: "1.2px",
            marginBottom: "6px",
          }}
        >
          ⚡ TRUSTCHARGE PRIORITY MEMBERSHIP
        </div>

        <h2
          style={{
            color: t.title,
            margin: "0 0 8px",
            fontSize: "22px",
          }}
        >
          Pick the pass that fits how you charge
        </h2>

        <p
          style={{
            color: t.muted,
            fontSize: "13px",
            margin: "0 0 18px",
            lineHeight: 1.5,
            maxWidth: "640px",
          }}
        >
          Members reserve ports for less (or nothing), book
          further ahead, hold more reservations at once and
          pay less for every kWh. Secure checkout by Mollie.
        </p>

        {/* =================================================
            CURRENT PLAN
        ================================================= */}

        <div
          style={{
            background: t.accentSoft,
            border: `1px solid ${t.accent}`,
            borderRadius: "12px",
            padding: "12px 14px",
            marginBottom: "16px",
            display: "flex",
            justifyContent: "space-between",
            gap: "10px",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "10px",
                fontWeight: 800,
                color: t.muted,
                letterSpacing: "1px",
              }}
            >
              YOUR CURRENT PLAN
            </div>

            <div
              style={{
                color: t.title,
                fontWeight: 800,
                fontSize: "15px",
                marginTop: "3px",
              }}
            >
              {activePlan?.label ||
                "No active membership"}
            </div>
          </div>

          <div
            style={{
              color: t.text,
              fontSize: "12px",
              textAlign: "right",
            }}
          >
            {activePlan
              ? expiresLabel
                ? `Active until ${expiresLabel}`
                : "Active"
              : "No active membership"}

            {wallet ? (
              <div
                style={{
                  color: t.muted,
                  marginTop: "3px",
                }}
              >
                Wallet: €
                {Number(wallet.balance || 0).toFixed(2)}
              </div>
            ) : null}
          </div>
        </div>

        {/* =================================================
            ERROR
        ================================================= */}

        {errorMessage && (
          <div
            style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid #EF4444",
              color: embedded
                ? "#B91C1C"
                : "#FCA5A5",
              padding: "10px 14px",
              borderRadius: "8px",
              fontSize: "13px",
              marginBottom: "15px",
            }}
          >
            {errorMessage}
          </div>
        )}

        {/* =================================================
            PLAN CARDS
        ================================================= */}

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit,minmax(260px,1fr))",
            gap: "12px",
            marginBottom: "20px",
          }}
        >
          {plans
            .filter((plan) => plan.id !== "STANDARD")
            .map((plan) => {
              const selected =
                selectedPlan === plan.id;

              const isCurrent =
                plan.id === activePlanId;

              const b = plan.benefits || {};

              return (
                <div
                  key={plan.id}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    setSelectedPlan(plan.id)
                  }
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" ||
                      e.key === " "
                    ) {
                      setSelectedPlan(plan.id);
                    }
                  }}
                  style={{
                    border: "2px solid",
                    borderColor: selected
                      ? t.accent
                      : t.tileBorder,
                    background: selected
                      ? t.accentSoft
                      : t.tile,
                    borderRadius: "14px",
                    padding: "16px",
                    cursor: "pointer",
                    position: "relative",
                    transition:
                      "all 0.2s ease",
                  }}
                >
                  {/* PRO BADGE */}

                  {plan.id === "PRO" && (
                    <span
                      style={{
                        position: "absolute",
                        top: "-10px",
                        right: "12px",
                        backgroundColor:
                          "#F59E0B",
                        color: "#0f172a",
                        fontSize: "10px",
                        fontWeight: 800,
                        padding: "3px 8px",
                        borderRadius: "999px",
                      }}
                    >
                      PRIORITY
                    </span>
                  )}

                  {/* CURRENT BADGE */}

                  {isCurrent && (
                    <span
                      style={{
                        position: "absolute",
                        top: "-10px",
                        left: "12px",
                        backgroundColor:
                          "#10B981",
                        color: "#FFFFFF",
                        fontSize: "10px",
                        fontWeight: 800,
                        padding: "3px 8px",
                        borderRadius: "999px",
                      }}
                    >
                      CURRENT
                    </span>
                  )}

                  <h3
                    style={{
                      color: t.title,
                      margin: "0 0 4px",
                      fontSize: "15px",
                    }}
                  >
                    {plan.label}
                  </h3>

                  <p
                    style={{
                      color: t.accent,
                      fontWeight: 800,
                      margin: "0 0 10px",
                      fontSize: "18px",
                    }}
                  >
                    €{Number(plan.price).toFixed(2)}
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: t.muted,
                      }}
                    >
                      {" "}
                      / month
                    </span>
                  </p>

                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: "none",
                      fontSize: "12px",
                      color: t.text,
                      lineHeight: 1.7,
                    }}
                  >
                    <li>
                      ✓{" "}
                      {b.reservationFeeDiscountPct >=
                      100
                        ? "Free reservations"
                        : b.reservationFeeDiscountPct >
                          0
                        ? `${b.reservationFeeDiscountPct}% off reservation fees`
                        : "Pay-per-reservation"}
                    </li>

                    <li>
                      {b.energyDiscountPct > 0
                        ? `✓ ${b.energyDiscountPct}% off charging energy`
                        : "– No energy discount"}
                    </li>

                    <li>
                      ✓ Book{" "}
                      {hoursLabel(
                        b.maxAdvanceHours
                      )}
                    </li>

                    <li>
                      ✓{" "}
                      {b.maxActiveReservations}{" "}
                      active reservation
                      {b.maxActiveReservations === 1
                        ? ""
                        : "s"}
                    </li>

                    {Number(plan.credit) > 0 && (
                      <li>
                        ✓ €
                        {Number(
                          plan.credit
                        ).toFixed(0)}{" "}
                        wallet credit
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
        </div>

        {/* =================================================
            COMPARISON TABLE
        ================================================= */}

        <div
          style={{
            overflowX: "auto",
            marginBottom: "18px",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "12px",
              minWidth: "560px",
            }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: "left",
                    padding: "8px",
                    color: t.muted,
                    fontWeight: 700,
                  }}
                >
                  Benefit
                </th>

                {plans
                  .filter(
                    (plan) =>
                      plan.id !== "STANDARD"
                  )
                  .map((plan) => (
                    <th
                      key={plan.id}
                      style={{
                        textAlign: "left",
                        padding: "8px",
                        color:
                          plan.id ===
                          selectedPlan
                            ? t.accent
                            : t.title,
                        fontWeight: 800,
                      }}
                    >
                      {plan.label.replace(
                        "TrustCharge ",
                        ""
                      )}
                    </th>
                  ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.label}
                  style={{
                    borderTop: `1px solid ${t.tableLine}`,
                  }}
                >
                  <td
                    style={{
                      padding: "9px 8px",
                      color: t.muted,
                    }}
                  >
                    {row.label}
                  </td>

                  {plans
                    .filter(
                      (plan) =>
                        plan.id !== "STANDARD"
                    )
                    .map((plan) => (
                      <td
                        key={plan.id}
                        style={{
                          padding: "9px 8px",
                          color: t.text,
                          fontWeight:
                            plan.id ===
                            selectedPlan
                              ? 700
                              : 500,
                        }}
                      >
                        {row.value(
                          plan,
                          plan.benefits
                        )}
                      </td>
                    ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* =================================================
            SAVING EXAMPLE
        ================================================= */}

        {chosen &&
          chosen.benefits.energyDiscountPct >
            0 && (
            <div
              style={{
                background: t.tile,
                border: `1px solid ${t.tileBorder}`,
                borderRadius: "10px",
                padding: "10px 12px",
                color: t.text,
                fontSize: "12px",
                marginBottom: "16px",
                lineHeight: 1.5,
              }}
            >
              Example: a {exampleKwh} kWh session at €
              {examplePrice.toFixed(2)}/kWh saves you
              about{" "}
              <strong>
                €{exampleSaving}
              </strong>{" "}
              with{" "}
              {chosen.label.replace(
                "TrustCharge ",
                ""
              )}
              . The discount is applied automatically
              to every charging session billed from your
              wallet.
            </div>
          )}

        {/* =================================================
            PLAN SWITCH MESSAGE
        ================================================= */}

        {switching && (
          <div
            style={{
              color: t.muted,
              fontSize: "12px",
              marginBottom: "12px",
            }}
          >
            Switching plan starts a fresh 30-day period
            for {chosen?.label}.
          </div>
        )}

        {/* =================================================
            BUTTONS
        ================================================= */}

        <div
          style={{
            display: "flex",
            gap: "10px",
          }}
        >
          {onBack && (
            <button
              type="button"
              disabled={loading}
              onClick={onBack}
              style={{
                flex: 1,
                backgroundColor: t.ghost,
                color: t.ghostText,
                padding: "14px",
                borderRadius: "10px",
                border: "none",
                fontWeight: 700,
                fontSize: "14px",
                cursor: loading
                  ? "not-allowed"
                  : "pointer",
                opacity: loading ? 0.7 : 1,
              }}
            >
              ← Back
            </button>
          )}

          <button
            type="button"
            disabled={loading || !chosen}
            onClick={handleMollieCheckout}
            style={{
              flex: 2,
              backgroundColor: "#10B981",
              color: "#FFFFFF",
              padding: "14px",
              borderRadius: "10px",
              border: "none",
              fontWeight: 800,
              fontSize: "15px",
              cursor:
                loading || !chosen
                  ? "not-allowed"
                  : "pointer",
              boxShadow:
                "0 4px 15px rgba(16,185,129,0.3)",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {payLabel}
          </button>
        </div>

        {/* =================================================
            FOOTER
        ================================================= */}

        <p
          style={{
            color: t.muted,
            fontSize: "11px",
            margin: "14px 0 0",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          You'll be redirected to Mollie's secure
          checkout and brought straight back here.
          Benefits switch on as soon as the payment is
          confirmed. Memberships last 30 days and do not
          renew automatically.
        </p>
      </div>
    </div>
  );
}
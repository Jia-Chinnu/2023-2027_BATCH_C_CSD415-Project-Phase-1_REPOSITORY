import { useState } from "react";

// Individual images for each slide placed in your public folder
const ONBOARDING_SLIDES = [
  {
    title: "Secure & Reliable Charging",
    description:
      "Connect safely to verified fast-charging stations with automated monitoring and robust protection.",
    image: "/Gemini_Generated_Image_3hlvi23hlvi23hlv (1).png",
  },
  {
    title: "Unified Digital Wallet",
    description:
      "Manage payments, track charging sessions, and access multiple networks effortlessly from one wallet.",
    image: "/Gemini_Generated_Image_ficw9xficw9xficw.png",
  },
  {
    title: "Smart Route Navigation",
    description:
      "Plan optimal routes with live station availability, battery range forecasting, and real-time mapping.",
    image: "/Gemini_Generated_Image_ffmv46ffmv46ffmv.png",
  },
];

export default function OnboardingScreen({ onFinish }) {
  const [activeSlide, setActiveSlide] = useState(0);

  const slide = ONBOARDING_SLIDES[activeSlide];

  const nextSlide = () => {
    if (activeSlide < ONBOARDING_SLIDES.length - 1) {
      setActiveSlide((prev) => prev + 1);
    } else {
      // Directly trigger onFinish to go straight to login page
      onFinish();
    }
  };

  const previousSlide = () => {
    if (activeSlide > 0) {
      setActiveSlide((prev) => prev - 1);
    }
  };

  return (
    <div style={styles.container}>
      {/* =====================================================
          RESPONSIVE FULL SCREEN IMAGE CONTAINER
          ===================================================== */}
      <div style={styles.heroSection}>
        <img
          src={slide.image}
          alt={slide.title}
          style={styles.fullScreenImage}
        />

        {/* Gradient fade at bottom for card readability */}
        <div style={styles.imageGradient} />

        {/* Slide counter */}
        <div style={styles.slideCounter}>
          {activeSlide + 1} / {ONBOARDING_SLIDES.length}
        </div>
      </div>

      {/* =====================================================
          FLOATING CONTENT CARD AT BOTTOM
          ===================================================== */}
      <div style={styles.contentArea}>
        <div style={styles.glassCard}>
          {/* TrustCharge logo */}
          <div style={styles.brandRow}>
            <div style={styles.smallBadge}>
              <span style={styles.smallBolt}>⚡</span>
            </div>

            <h3 style={styles.brandText}>
              Trust<span style={{ color: "#D97706" }}>Charge</span>
            </h3>
          </div>

          {/* Text */}
          <div style={styles.textArea}>
            <h2 style={styles.slideTitle}>{slide.title}</h2>
            <p style={styles.slideDescription}>{slide.description}</p>
          </div>

          {/* Bottom controls */}
          <div style={styles.controlsRow}>
            {/* Dots */}
            <div style={styles.dotsContainer}>
              {ONBOARDING_SLIDES.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setActiveSlide(index)}
                  aria-label={`Go to slide ${index + 1}`}
                  style={{
                    ...styles.dot,
                    width: activeSlide === index ? "28px" : "8px",
                    backgroundColor:
                      activeSlide === index ? "#D97706" : "#D6D3D1",
                  }}
                />
              ))}
            </div>

            {/* Navigation */}
            <div style={styles.navigationButtons}>
              {activeSlide > 0 && (
                <button onClick={previousSlide} style={styles.backButton}>
                  ←
                </button>
              )}

              <button onClick={nextSlide} style={styles.actionButton}>
                {activeSlide === ONBOARDING_SLIDES.length - 1
                  ? "Get Started"
                  : "Continue"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    width: "100vw",
    height: "100vh",
    backgroundColor: "#FBF8F3",
    position: "relative",
    overflow: "hidden",
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    userSelect: "none",
    boxSizing: "border-box",
  },

  heroSection: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    overflow: "hidden",
    zIndex: 1,
  },

  fullScreenImage: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: "center center",
    transition: "opacity 0.4s ease-in-out",
  },

  imageGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "55%",
    background:
      "linear-gradient(to bottom, rgba(251,248,243,0) 0%, rgba(251,248,243,0.6) 50%, rgba(251,248,243,0.95) 100%)",
    pointerEvents: "none",
    zIndex: 2,
  },

  slideCounter: {
    position: "absolute",
    top: "24px",
    left: "24px",
    padding: "6px 12px",
    borderRadius: "999px",
    backgroundColor: "rgba(255,255,255,0.85)",
    backdropFilter: "blur(10px)",
    color: "#57534E",
    fontSize: "11px",
    fontWeight: "700",
    zIndex: 10,
  },

  contentArea: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    width: "100%",
    display: "flex",
    justifyContent: "center",
    padding: "0 20px 28px 20px",
    boxSizing: "border-box",
    zIndex: 20,
  },

  glassCard: {
    width: "100%",
    maxWidth: "600px",
    backgroundColor: "rgba(255,255,255,0.92)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    borderRadius: "24px",
    padding: "20px 22px",
    boxSizing: "border-box",
    border: "1px solid rgba(245,158,11,0.2)",
    boxShadow: "0 20px 40px rgba(120,70,10,0.12)",
  },

  brandRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "10px",
  },

  smallBadge: {
    width: "28px",
    height: "28px",
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #F59E0B, #D97706)",
    boxShadow: "0 4px 10px rgba(217,119,6,0.25)",
  },

  smallBolt: {
    color: "#FFFFFF",
    fontSize: "12px",
    fontWeight: "900",
  },

  brandText: {
    margin: 0,
    fontSize: "14px",
    fontWeight: "800",
    color: "#292524",
  },

  textArea: {
    marginBottom: "16px",
  },

  slideTitle: {
    margin: "0 0 6px 0",
    fontSize: "clamp(20px, 3.5vw, 24px)",
    lineHeight: "1.2",
    fontWeight: "800",
    color: "#1C1917",
    letterSpacing: "-0.02em",
  },

  slideDescription: {
    margin: 0,
    fontSize: "13px",
    lineHeight: "1.5",
    color: "#78716C",
  },

  controlsRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
  },

  dotsContainer: {
    display: "flex",
    alignItems: "center",
    gap: "5px",
    flexShrink: 0,
  },

  dot: {
    height: "8px",
    padding: 0,
    border: "none",
    borderRadius: "999px",
    cursor: "pointer",
    transition: "all 0.3s ease",
  },

  navigationButtons: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },

  backButton: {
    width: "40px",
    height: "40px",
    borderRadius: "12px",
    border: "1px solid #E7E5E4",
    backgroundColor: "#FFFFFF",
    color: "#57534E",
    fontSize: "18px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  actionButton: {
    backgroundColor: "#D97706",
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: "13px",
    padding: "12px 20px",
    borderRadius: "12px",
    border: "none",
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: "0 6px 16px rgba(217,119,6,0.25)",
    transition: "all 0.2s ease",
  },
};
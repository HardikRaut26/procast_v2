'use client';

import { Link, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { isAuthenticated } from "../utils/auth";

function Home() {
  const navigate = useNavigate();
  const location = useLocation();

  const handleGetStartedClick = () => {
    if (isAuthenticated()) {
      navigate("/call");
    } else {
      navigate("/login");
    }
  };

  useEffect(() => {
    const scrollTo = location.state && location.state.scrollTo;
    if (!scrollTo) return;

    const el = document.getElementById(scrollTo);
    if (!el) return;

    const offset = 90;
    const rect = el.getBoundingClientRect();
    const targetY = rect.top + window.scrollY - offset;

    // small timeout to ensure layout is ready
    setTimeout(() => {
      window.scrollTo({ top: targetY, behavior: "smooth" });
    }, 0);
  }, [location]);

  return (
    <div style={styles.container}>
      <style>{keyframes}</style>

      {/* HERO */}
      <section style={styles.hero}>
        <div style={styles.heroContent}>
          <AnimatedText delay={0}>
            <h1 style={styles.heroTitle}>
              Record, Collaborate, and
              <br />
              <span style={styles.heroHighlight}>Enhance Your Podcasts</span>
            </h1>
          </AnimatedText>
          
          <AnimatedText delay={200}>
            <p style={styles.heroSubtitle}>
              Real-time multi-participant recording with AI transcription,
              summaries, and smart highlights. Built for creators who demand excellence.
            </p>
          </AnimatedText>

          <AnimatedText delay={400}>
            <div style={styles.heroButtons}>
              <Link to="/call" style={{ textDecoration: 'none' }}>
                <HoverButton primary>
                  <span style={styles.buttonIcon}>●</span>
                  Start Recording
                </HoverButton>
              </Link>
              <HoverButton>
                <span style={styles.playIcon}>▶</span>
                Watch Demo
              </HoverButton>
            </div>
          </AnimatedText>
        </div>

        {/* Animated background elements */}
        <div style={styles.heroBackground}>
          <div style={styles.floatingOrb1} />
          <div style={styles.floatingOrb2} />
          <div style={styles.floatingOrb3} />
          <div style={styles.gridOverlay} />
        </div>

        {/* Scroll indicator */}
        <div style={styles.scrollIndicator}>
          <div style={styles.scrollMouse}>
            <div style={styles.scrollWheel} />
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" style={styles.section}>
        <AnimatedSection>
          <p style={styles.sectionLabel}>FEATURES</p>
          <h2 style={styles.sectionTitle}>Powerful Tools for Creators</h2>
          <p style={styles.sectionSubtitle}>
            Everything you need to produce professional-quality podcasts
          </p>
        </AnimatedSection>

        <div style={styles.featuresGrid}>
          <FeatureCard 
            icon="◎" 
            title="Real-time Recording" 
            desc="Studio-quality audio & video capture with zero latency synchronization"
            delay={0}
          />
          <FeatureCard 
            icon="≡" 
            title="AI Transcription" 
            desc="Instant transcripts & intelligent summaries powered by advanced AI"
            delay={100}
          />
          <FeatureCard 
            icon="◆" 
            title="Smart Highlights" 
            desc="Automatically detect and mark key moments in your recordings"
            delay={200}
          />
          <FeatureCard 
            icon="☁" 
            title="Cloud Storage" 
            desc="Secure cloud storage with unlimited access from anywhere"
            delay={300}
          />
          <FeatureCard 
            icon="⊕" 
            title="Collaboration" 
            desc="Invite guests and record together in perfect sync"
            delay={400}
          />
          <FeatureCard 
            icon="◐" 
            title="Analytics" 
            desc="Deep insights into engagement and audience behavior"
            delay={500}
          />
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" style={styles.howItWorks}>
        <AnimatedSection>
          <p style={styles.sectionLabel}>WORKFLOW</p>
          <h2 style={styles.sectionTitle}>From Recording to Publishing</h2>
          <p style={styles.sectionSubtitle}>
            A seamless four-step process designed for efficiency
          </p>
        </AnimatedSection>

        <div style={styles.stepsContainer}>
          <StepCard 
            number="01" 
            title="Create & Invite" 
            desc="Set up your session and invite guests with a single link"
            delay={0}
          />
          <div style={styles.stepConnector}>
            <div style={styles.connectorLine} />
          </div>
          <StepCard 
            number="02" 
            title="Record Together" 
            desc="Capture perfectly synchronized multi-track sessions"
            delay={150}
          />
          <div style={styles.stepConnector}>
            <div style={styles.connectorLine} />
          </div>
          <StepCard 
            number="03" 
            title="AI Enhancement" 
            desc="Get instant transcripts, summaries, and highlights"
            delay={300}
          />
          <div style={styles.stepConnector}>
            <div style={styles.connectorLine} />
          </div>
          <StepCard 
            number="04" 
            title="Share & Publish" 
            desc="Export and distribute to all major platforms"
            delay={450}
          />
        </div>
      </section>

      {/* STATS */}
      <section style={styles.statsSection}>
        <div style={styles.statsGrid}>
          <StatItem number="50K+" label="Active Creators" />
          <StatItem number="1M+" label="Podcasts Recorded" />
          <StatItem number="99.9%" label="Uptime" />
          <StatItem number="4.9★" label="User Rating" />
        </div>
      </section>

      {/* CTA */}
      <section style={styles.cta}>
        <AnimatedSection>
          <h2 style={styles.ctaTitle}>
            Ready to start your
            <br />
            podcast journey?
          </h2>
          <p style={styles.ctaSubtitle}>
            Join thousands of creators already using ProCast
          </p>
          <Link to="/register" style={{ textDecoration: 'none' }}>
            <HoverButton primary large>
              Start Free Trial
              <span style={styles.arrowIcon}>→</span>
            </HoverButton>
          </Link>
          <p style={styles.ctaNote}>No credit card required</p>
        </AnimatedSection>
      </section>

      {/* FOOTER */}
      <footer style={styles.footer}>
        <div style={styles.footerContent}>
          <div style={styles.footerBrand}>
            <span style={styles.logoIcon}>◉</span>
            <span style={styles.logoText}>ProCast</span>
          </div>
          <div style={styles.footerLinks}>
            <a href="#" style={styles.footerLink}>Privacy</a>
            <a href="#" style={styles.footerLink}>Terms</a>
            <a href="#" style={styles.footerLink}>Contact</a>
          </div>
          <p style={styles.footerCopy}>© 2024 ProCast. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

// Animated Text Component
function AnimatedText({ children, delay = 0 }) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      ref={ref}
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(30px)',
        transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {children}
    </div>
  );
}

// Animated Section Component
function AnimatedSection({ children }) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.1 }
    );

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(40px)',
        transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {children}
    </div>
  );
}

// Hover Button Component
function HoverButton({ children, primary, large }) {
  const [isHovered, setIsHovered] = useState(false);

  const baseStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    padding: large ? '18px 36px' : '14px 28px',
    fontSize: large ? '18px' : '16px',
    fontWeight: '500',
    border: 'none',
    borderRadius: '50px',
    cursor: 'pointer',
    transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
    fontFamily: 'inherit',
  };

  const primaryStyle = {
    ...baseStyle,
    background: isHovered ? '#fff' : '#000',
    color: isHovered ? '#000' : '#fff',
    transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
    boxShadow: isHovered 
      ? '0 20px 40px rgba(0,0,0,0.3)' 
      : '0 4px 20px rgba(0,0,0,0.2)',
  };

  const secondaryStyle = {
    ...baseStyle,
    background: isHovered ? '#000' : 'transparent',
    color: isHovered ? '#fff' : '#000',
    border: '2px solid #000',
    transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
  };

  return (
    <button
      style={primary ? primaryStyle : secondaryStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {children}
    </button>
  );
}

// Feature Card Component
function FeatureCard({ icon, title, desc, delay }) {
  const [isHovered, setIsHovered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => setIsVisible(true), delay);
        }
      },
      { threshold: 0.1 }
    );

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <div
      ref={ref}
      style={{
        ...styles.featureCard,
        opacity: isVisible ? 1 : 0,
        transform: isVisible 
          ? isHovered ? 'translateY(-8px)' : 'translateY(0)'
          : 'translateY(30px)',
        background: isHovered ? '#000' : '#fff',
        borderColor: isHovered ? '#000' : '#e5e5e5',
        boxShadow: isHovered 
          ? '0 25px 50px rgba(0,0,0,0.15)' 
          : '0 0 0 rgba(0,0,0,0)',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={{
        ...styles.featureIcon,
        color: isHovered ? '#fff' : '#000',
        background: isHovered ? 'rgba(255,255,255,0.1)' : '#f5f5f5',
      }}>
        {icon}
      </div>
      <h3 style={{
        ...styles.featureTitle,
        color: isHovered ? '#fff' : '#000',
      }}>{title}</h3>
      <p style={{
        ...styles.featureDesc,
        color: isHovered ? 'rgba(255,255,255,0.7)' : '#666',
      }}>{desc}</p>
    </div>
  );
}

// Step Card Component
function StepCard({ number, title, desc, delay }) {
  const [isHovered, setIsHovered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => setIsVisible(true), delay);
        }
      },
      { threshold: 0.1 }
    );

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <div
      ref={ref}
      style={{
        ...styles.stepCard,
        opacity: isVisible ? 1 : 0,
        transform: isVisible 
          ? isHovered ? 'scale(1.02)' : 'scale(1)'
          : 'translateY(20px)',
        background: isHovered ? '#000' : '#fafafa',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span style={{
        ...styles.stepNumber,
        color: isHovered ? '#fff' : '#000',
      }}>{number}</span>
      <h3 style={{
        ...styles.stepTitle,
        color: isHovered ? '#fff' : '#000',
      }}>{title}</h3>
      <p style={{
        ...styles.stepDesc,
        color: isHovered ? 'rgba(255,255,255,0.7)' : '#666',
      }}>{desc}</p>
    </div>
  );
}

// Stat Item Component
function StatItem({ number, label }) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.1 }
    );

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{
        ...styles.statItem,
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
      }}
    >
      <span style={styles.statNumber}>{number}</span>
      <span style={styles.statLabel}>{label}</span>
    </div>
  );
}

// CSS Keyframes
const keyframes = `
  @keyframes float1 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    50% { transform: translate(30px, -30px) scale(1.1); }
  }
  @keyframes float2 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    50% { transform: translate(-20px, 20px) scale(0.9); }
  }
  @keyframes float3 {
    0%, 100% { transform: translate(0, 0); }
    50% { transform: translate(15px, 15px); }
  }
  @keyframes scroll {
    0%, 100% { transform: translateY(0); opacity: 1; }
    50% { transform: translateY(8px); opacity: 0.5; }
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 1; }
  }
`;

const styles = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    background: '#fff',
    color: '#000',
    overflowX: 'hidden',
  },

  // Navbar
  nav: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 60px',
    background: 'rgba(255,255,255,0.9)',
    backdropFilter: 'blur(20px)',
    zIndex: 1000,
    borderBottom: '1px solid rgba(0,0,0,0.05)',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  logoIcon: {
    fontSize: '24px',
  },
  logoText: {
    fontSize: '20px',
    fontWeight: '700',
    letterSpacing: '-0.5px',
  },
  navLinks: {
    display: 'flex',
    alignItems: 'center',
    gap: '40px',
  },
  navLink: {
    color: '#666',
    textDecoration: 'none',
    fontSize: '15px',
    fontWeight: '500',
    transition: 'color 0.2s',
  },
  navButton: {
    padding: '10px 24px',
    background: '#000',
    color: '#fff',
    borderRadius: '50px',
    textDecoration: 'none',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'all 0.2s',
  },

  // Hero
  hero: {
    position: 'relative',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    textAlign: 'center',
    padding: '120px 20px 60px',
    overflow: 'hidden',
  },
  heroContent: {
    position: 'relative',
    zIndex: 2,
    maxWidth: '900px',
  },
  heroTitle: {
    fontSize: 'clamp(40px, 8vw, 80px)',
    fontWeight: '700',
    lineHeight: '1.1',
    letterSpacing: '-2px',
    margin: '0 0 30px',
  },
  heroHighlight: {
    background: 'linear-gradient(90deg, #000 0%, #666 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  heroSubtitle: {
    fontSize: 'clamp(18px, 2.5vw, 22px)',
    color: '#666',
    lineHeight: '1.6',
    maxWidth: '600px',
    margin: '0 auto 40px',
  },
  heroButtons: {
    display: 'flex',
    gap: '16px',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  buttonIcon: {
    fontSize: '10px',
    color: '#ff4444',
    animation: 'pulse 2s infinite',
  },
  playIcon: {
    fontSize: '12px',
  },
  heroBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
    overflow: 'hidden',
  },
  floatingOrb1: {
    position: 'absolute',
    top: '20%',
    left: '10%',
    width: '300px',
    height: '300px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(0,0,0,0.03) 0%, transparent 70%)',
    animation: 'float1 8s ease-in-out infinite',
  },
  floatingOrb2: {
    position: 'absolute',
    top: '60%',
    right: '10%',
    width: '400px',
    height: '400px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(0,0,0,0.02) 0%, transparent 70%)',
    animation: 'float2 10s ease-in-out infinite',
  },
  floatingOrb3: {
    position: 'absolute',
    bottom: '20%',
    left: '30%',
    width: '200px',
    height: '200px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(0,0,0,0.02) 0%, transparent 70%)',
    animation: 'float3 6s ease-in-out infinite',
  },
  gridOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundImage: `
      linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px)
    `,
    backgroundSize: '60px 60px',
  },
  scrollIndicator: {
    position: 'absolute',
    bottom: '40px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 2,
  },
  scrollMouse: {
    width: '26px',
    height: '40px',
    border: '2px solid rgba(0,0,0,0.2)',
    borderRadius: '15px',
    display: 'flex',
    justifyContent: 'center',
    paddingTop: '8px',
  },
  scrollWheel: {
    width: '4px',
    height: '8px',
    background: '#000',
    borderRadius: '2px',
    animation: 'scroll 2s infinite',
  },

  // Sections
  section: {
    padding: '120px 60px',
    textAlign: 'center',
  },
  sectionLabel: {
    fontSize: '12px',
    fontWeight: '600',
    letterSpacing: '3px',
    color: '#999',
    marginBottom: '16px',
  },
  sectionTitle: {
    fontSize: 'clamp(32px, 5vw, 48px)',
    fontWeight: '700',
    letterSpacing: '-1px',
    margin: '0 0 16px',
  },
  sectionSubtitle: {
    fontSize: '18px',
    color: '#666',
    maxWidth: '500px',
    margin: '0 auto 60px',
  },

  // Features
  featuresGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '24px',
    maxWidth: '1200px',
    margin: '0 auto',
  },
  featureCard: {
    padding: '40px',
    border: '1px solid #e5e5e5',
    borderRadius: '24px',
    textAlign: 'left',
    transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
    cursor: 'default',
  },
  featureIcon: {
    width: '56px',
    height: '56px',
    borderRadius: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
    marginBottom: '24px',
    transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
  },
  featureTitle: {
    fontSize: '20px',
    fontWeight: '600',
    margin: '0 0 12px',
    transition: 'color 0.4s',
  },
  featureDesc: {
    fontSize: '15px',
    lineHeight: '1.6',
    margin: 0,
    transition: 'color 0.4s',
  },

  // How It Works
  howItWorks: {
    padding: '120px 60px',
    textAlign: 'center',
    background: '#fafafa',
  },
  stepsContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0',
    maxWidth: '1200px',
    margin: '0 auto',
    flexWrap: 'wrap',
  },
  stepCard: {
    flex: '1 1 200px',
    maxWidth: '250px',
    padding: '40px 30px',
    borderRadius: '24px',
    textAlign: 'center',
    transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
    cursor: 'default',
  },
  stepNumber: {
    display: 'block',
    fontSize: '48px',
    fontWeight: '700',
    marginBottom: '16px',
    transition: 'color 0.4s',
  },
  stepTitle: {
    fontSize: '18px',
    fontWeight: '600',
    margin: '0 0 8px',
    transition: 'color 0.4s',
  },
  stepDesc: {
    fontSize: '14px',
    lineHeight: '1.5',
    margin: 0,
    transition: 'color 0.4s',
  },
  stepConnector: {
    width: '60px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectorLine: {
    width: '100%',
    height: '2px',
    background: 'linear-gradient(90deg, #ddd 0%, #bbb 50%, #ddd 100%)',
  },

  // Stats
  statsSection: {
    padding: '80px 60px',
    background: '#000',
  },
  statsGrid: {
    display: 'flex',
    justifyContent: 'center',
    gap: '80px',
    flexWrap: 'wrap',
    maxWidth: '1000px',
    margin: '0 auto',
  },
  statItem: {
    textAlign: 'center',
    transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
  },
  statNumber: {
    display: 'block',
    fontSize: 'clamp(36px, 5vw, 56px)',
    fontWeight: '700',
    color: '#fff',
    letterSpacing: '-1px',
  },
  statLabel: {
    display: 'block',
    fontSize: '14px',
    color: 'rgba(255,255,255,0.5)',
    marginTop: '8px',
    textTransform: 'uppercase',
    letterSpacing: '2px',
  },

  // CTA
  cta: {
    padding: '160px 60px',
    textAlign: 'center',
    background: '#fff',
    position: 'relative',
  },
  ctaTitle: {
    fontSize: 'clamp(36px, 6vw, 60px)',
    fontWeight: '700',
    letterSpacing: '-2px',
    lineHeight: '1.1',
    margin: '0 0 20px',
  },
  ctaSubtitle: {
    fontSize: '18px',
    color: '#666',
    marginBottom: '40px',
  },
  arrowIcon: {
    marginLeft: '4px',
    transition: 'transform 0.3s',
  },
  ctaNote: {
    fontSize: '14px',
    color: '#999',
    marginTop: '20px',
  },

  // Footer
  footer: {
    padding: '60px',
    borderTop: '1px solid #eee',
    background: '#fafafa',
  },
  footerContent: {
    maxWidth: '1200px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '24px',
  },
  footerBrand: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  footerLinks: {
    display: 'flex',
    gap: '32px',
  },
  footerLink: {
    color: '#666',
    textDecoration: 'none',
    fontSize: '14px',
    transition: 'color 0.2s',
  },
  footerCopy: {
    fontSize: '13px',
    color: '#999',
    margin: 0,
  },
};

export default Home;

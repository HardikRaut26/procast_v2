'use client';

import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [token, setToken] = useState(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    // Check token on mount and whenever location changes
    setToken(localStorage.getItem("token"));

    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };

    // Also listen for storage changes (auto-logout/login from other tabs)
    const handleStorageChange = () => {
      setToken(localStorage.getItem("token"));
    };

    window.addEventListener("scroll", handleScroll);
    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [location.pathname]); // Re-run when navigating

  const handleGetStartedClick = () => {
    if (token) {
      navigate("/call");
    } else {
      navigate("/login");
    }
  };

  const handleCallClick = () => {
    const hasToken = !!localStorage.getItem("token");
    if (hasToken) {
      navigate("/call");
    } else {
      navigate("/login");
    }
  };

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (!el) return;

    const offset = 90; // account for fixed navbar height
    const rect = el.getBoundingClientRect();
    const targetY = rect.top + window.scrollY - offset;

    window.scrollTo({
      top: targetY,
      behavior: "smooth",
    });
  };

  const handleSectionClick = (sectionId) => {
    if (location.pathname === "/") {
      scrollToSection(sectionId);
    } else {
      navigate("/", { state: { scrollTo: sectionId } });
    }
  };

  const handleHomeClick = () => {
    if (location.pathname === "/") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      navigate("/");
    }
  };

  const NavItem = ({ to, href, onClick, children }) => {
    const [hovered, setHovered] = useState(false);

    const baseStyle = {
      ...styles.navLink,
      ...(hovered ? styles.navLinkHover : {}),
      backgroundSize: hovered ? '100% 2px' : '0% 2px',
    };

    const commonProps = {
      style: baseStyle,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onClick,
    };

    if (to) {
      return (
        <Link to={to} {...commonProps}>
          {children}
        </Link>
      );
    }

    if (href) {
      return (
        <a href={href} {...commonProps}>
          {children}
        </a>
      );
    }

    return (
      <button
        type="button"
        {...commonProps}
        style={{ ...baseStyle, background: "none", border: "none" }}
      >
        {children}
      </button>
    );
  };

  const isCallPage = location.pathname === "/call";
  const navBackground = isCallPage
    ? "rgba(255,255,255,0.98)"
    : scrolled
      ? "rgba(255,255,255,0.95)"
      : "rgba(255,255,255,0.8)";

  return (
    <nav
      style={{
        ...styles.nav,
        background: navBackground,
        boxShadow: scrolled || isCallPage ? "0 4px 30px rgba(0,0,0,0.1)" : "none",
      }}
    >
      <Link to="/" style={{ textDecoration: "none", color: "inherit" }}>
        <div style={styles.logo}>
          <span style={styles.logoIcon}>◉</span>
          <span style={styles.logoText}>ProCast</span>
        </div>
      </Link>

      <div style={styles.navLinks}>
        <NavItem onClick={handleHomeClick}>Home</NavItem>
        <NavItem onClick={() => handleSectionClick("features")}>Features</NavItem>
        <NavItem onClick={() => handleSectionClick("how-it-works")}>How it Works</NavItem>

        {!token ? (
          <>
            <NavItem to="/login">Sign In</NavItem>
            <button
              type="button"
              style={styles.navButton}
              onClick={handleGetStartedClick}
            >
              Get Started
            </button>
          </>
        ) : (
          <>
            <NavItem onClick={handleCallClick}>Call</NavItem>
            <NavItem to="/library">Library</NavItem>
            <NavItem to="/profile">Profile</NavItem>
          </>
        )}
      </div>
    </nav>
  );
}

const styles = {
  nav: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 48px',
    backdropFilter: 'blur(20px)',
    zIndex: 1000,
    transition: 'all 0.3s ease',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    cursor: 'pointer',
  },
  logoIcon: {
    fontSize: '28px',
    color: '#000',
  },
  logoText: {
    fontSize: '22px',
    fontWeight: '700',
    letterSpacing: '-0.5px',
    color: '#000',
  },
  navLinks: {
    display: 'flex',
    alignItems: 'center',
    gap: '32px',
  },
  navLink: {
    color: '#333',
    textDecoration: 'none',
    fontSize: '14px',
    fontWeight: '500',
    paddingBottom: 4,
    backgroundImage: 'linear-gradient(#000, #000)',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center bottom',
    backgroundSize: '0% 2px',
    transition: 'color 0.2s, background-size 0.3s ease',
    cursor: 'pointer',
  },
  navLinkHover: {
    color: '#000',
  },
  navButton: {
    padding: '10px 24px',
    background: '#000',
    color: '#fff',
    borderRadius: '50px',
    textDecoration: 'none',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'all 0.3s ease',
  },
  logoutButton: {
    padding: '10px 24px',
    background: 'transparent',
    color: '#000',
    border: '2px solid #000',
    borderRadius: '50px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    fontFamily: 'inherit',
  },
};

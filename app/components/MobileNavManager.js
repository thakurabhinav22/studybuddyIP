"use client";

import { useEffect } from "react";

export default function MobileNavManager() {
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    let scrollTimer = null;
    let activeTimer = null;

    const setClass = (className, enabled) => {
      document.body.classList.toggle(className, enabled);
    };

    const setMobileState = () => {
      const isMobile = mq.matches;
      setClass("mobile-nav-liquid", isMobile);
      setClass("mobile-nav-compact", isMobile);
      setClass("mobile-nav-scrolling", false);
      setClass("mobile-nav-active", false);
    };

    const onScroll = () => {
      if (!mq.matches) return;
      setClass("mobile-nav-liquid", true);
      setClass("mobile-nav-compact", true);
      setClass("mobile-nav-scrolling", true);
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        setClass("mobile-nav-scrolling", false);
      }, 180);
    };

    const onNavUse = (event) => {
      if (!mq.matches) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".mob-nav")) return;

      setClass("mobile-nav-liquid", true);
      setClass("mobile-nav-compact", true);
      setClass("mobile-nav-active", true);
      window.clearTimeout(activeTimer);
      activeTimer = window.setTimeout(() => {
        setClass("mobile-nav-active", false);
      }, 900);
    };

    setMobileState();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("touchstart", onNavUse, { passive: true });
    window.addEventListener("pointerdown", onNavUse, { passive: true });
    mq.addEventListener("change", setMobileState);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("touchstart", onNavUse);
      window.removeEventListener("pointerdown", onNavUse);
      mq.removeEventListener("change", setMobileState);
      window.clearTimeout(scrollTimer);
      window.clearTimeout(activeTimer);
      document.body.classList.remove(
        "mobile-nav-liquid",
        "mobile-nav-compact",
        "mobile-nav-scrolling",
        "mobile-nav-active"
      );
    };
  }, []);

  return null;
}
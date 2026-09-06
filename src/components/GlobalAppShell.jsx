import React from "react";

const PUBLIC_LINKS = [
  { href: "/book", label: "Book" },
  { href: "/apply", label: "Careers / Apply" },
];

function isActive(href, pathname) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/admin");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function GlobalAppShell({ children, publicView = false }) {
  const pathname = typeof window === "undefined" ? "/" : window.location.pathname.replace(/\/+$/, "") || "/";

  return (
    <div className={`global-app-shell ${publicView ? "global-app-shell--public" : "global-app-shell--workspace"}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="global-nav">
        <div className="global-nav__inner">
          <a className="global-brand" href="https://haveusclean.ca" aria-label="Have Us Clean home">
            <span className="global-brand__mark" aria-hidden="true">H</span>
            <span className="global-brand__copy"><strong>Have Us Clean</strong><small>ServiceOS</small></span>
          </a>
          <nav className="global-nav__links" aria-label="Primary navigation">
            <div className="global-nav__group" aria-label="Public services">
              <span className="global-nav__group-label">Services</span>
              {PUBLIC_LINKS.map((link) => <a key={link.href} href={link.href} className={isActive(link.href, pathname) ? "is-active" : ""} aria-current={isActive(link.href, pathname) ? "page" : undefined}>{link.label}</a>)}
            </div>
            <div className="global-nav__divider" aria-hidden="true" />
            <div className="global-nav__group global-nav__group--workspace" aria-label="Authenticated workspace">
              <span className="global-nav__group-label">Workspace</span>
              <a href="/" className={isActive("/", pathname) ? "is-active" : ""} aria-current={isActive("/", pathname) ? "page" : undefined}>Admin / Dispatch</a>
            </div>
          </nav>
        </div>
      </header>
      <div id="main-content" className="global-app-shell__content">{children}</div>
      {publicView ? (
        <footer className="global-footer">
          <div className="global-footer__inner">
            <div><strong>Have Us Clean</strong><p>Professional cleaning, thoughtfully coordinated.</p></div>
            <nav aria-label="Legal"><a href="https://haveusclean.ca/privacy-policy">Privacy</a><a href="https://haveusclean.ca/terms-of-service">Terms</a><a href="mailto:haveusclean@gmail.com">Contact</a></nav>
            <div className="global-footer__markets" aria-label="Service markets"><span>HUC-ON</span><span>HUC-AZ</span></div>
          </div>
        </footer>
      ) : null}
    </div>
  );
}

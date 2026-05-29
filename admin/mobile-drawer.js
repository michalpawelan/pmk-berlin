// admin/mobile-drawer.js
// Activates the mobile drawer behavior at viewport <= 720px.

(function () {
  const BREAKPOINT = 720;
  const sidebar = () => document.querySelector('.admin-sidebar');
  const hamburger = () => document.getElementById('adminHamburger');
  const backdrop = () => document.getElementById('adminBackdrop');

  function isMobile() { return window.matchMedia(`(max-width: ${BREAKPOINT}px)`).matches; }

  function openDrawer() {
    sidebar()?.classList.add('admin-sidebar-open');
    backdrop().hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    sidebar()?.classList.remove('admin-sidebar-open');
    backdrop().hidden = true;
    document.body.style.overflow = '';
  }

  function applyMode() {
    const h = hamburger();
    if (!h) return;
    h.hidden = !isMobile();
    if (!isMobile()) closeDrawer();
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyMode();
    hamburger()?.addEventListener('click', () => {
      const isOpen = sidebar()?.classList.contains('admin-sidebar-open');
      if (isOpen) closeDrawer(); else openDrawer();
    });
    backdrop()?.addEventListener('click', closeDrawer);
    // close on nav item click
    document.querySelectorAll('.admin-sidebar .admin-nav-item').forEach(el => {
      el.addEventListener('click', () => { if (isMobile()) closeDrawer(); });
    });
    window.addEventListener('resize', applyMode);
  });
})();

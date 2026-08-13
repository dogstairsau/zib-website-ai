/**
 * ZiB OS — shared partner registry (single source of truth).
 *
 * Every ZiB OS module (Growth Simulator, AI Readiness, Automation Map, the OS
 * hub, …) brands from this one object via ?partner=<slug>. Loaded as a plain
 * script so any static page can read window.ZIB_PARTNERS — no build step.
 *
 * Fields: name, title, email, phone (optional), photo (optional — initials
 * fallback when empty), tagline. Sourced from each partner's own page.
 */
window.ZIB_PARTNERS = {
  'chelsea-teelow':  { name: 'Chelsea Teelow',          title: 'Growth Partner · Adelaide & SA',    email: 'chelsea.teelow@zibdigital.com.au',  phone: '',             photo: '/assets/chelsea-header.webp',           tagline: 'Twenty years across sales, marketing and media. Paid social speciality.' },
  'corrine-chalmers':{ name: 'Corrine Chalmers',        title: 'Growth Partner · Geelong',          email: 'corrine.chalmers@zibdigital.com.au',phone: '',             photo: '/assets/corrine-front.webp',            tagline: 'Entrepreneur turned growth specialist — built and run multiple ventures.' },
  'daniel-harris':   { name: 'Daniel Harris',           title: 'Growth Specialist',                 email: 'daniel.harris@zibdigital.com.au',   phone: '',             photo: '/assets/dan-harris-header-photo.jpeg',  tagline: 'A decade across finance, sport, telco, utilities and government.' },
  'dylan-and-jake':  { name: 'Dylan & Jake Pinksterboer', title: 'Growth Partners · Adelaide & SA', email: '',                                  phone: '',             photo: '/assets/dylan-and-jake-104.webp',       tagline: 'Twin brothers, sales-driven growth specialists. Hospitality speciality.' },
  'marty-tucker':    { name: 'Marty Tucker',            title: 'Growth Partner · Melbourne Bayside',email: 'marty.tucker@zibdigital.com.au',    phone: '',             photo: '/assets/marty-tucker-header.png',       tagline: 'Decades of sales, account management and media experience.' },
  'matt-arnot':      { name: 'Matt Arnot',              title: 'Growth Specialist',                 email: 'matt.arnot@zibdigital.com.au',      phone: '',             photo: '',                                      tagline: 'Local commercial digital marketing.' },
};

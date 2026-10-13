// The walkthrough, in the order a new rep would actually learn the product.
//
// Every step is a real interaction performed against the running app while
// the screen is being recorded — the typing, the upload, the camera flights,
// the modal, the removal of a property are all genuinely happening.
//
// Each step is:
//   id       scene id; also the narration filename (narration/<id>.wav)
//   say      what the voice says over this step
//   caption  the on-screen lower third (injected into the page, not overlaid
//            afterwards, so it is always in step with what's on screen)
//   run      the actual interaction, given the driver context
//
// A step always lasts at least as long as its own narration — record.mjs
// pads it — so the voice is never cut off by the next action.
//
// LENGTH IS THE DESIGN CONSTRAINT. The first cut ran 6:27 across 27 steps and
// lost people well before the end. This is 12 steps targeting under three
// minutes: related actions are merged into one step rather than narrated
// separately, and anything that is merely nice to see (the city switcher, the
// legend toggle, My Areas, Clients, global search) is cut outright — a rep
// who wants those will find them. Narration is written to be read once and
// understood, not to be comprehensive.

export const DEMO = {
  client: "Acme Retail",
  campaign: "Festive Launch",
  // The repo's own multi-city test sheet: Hyderabad, Bengaluru and Delhi.
  sheet: "multi_city_shortlist_test.xlsx",
};

export const steps = [
  {
    id: "01-intro",
    say: "This is Adonmo. It turns a client's shortlist into a map they can actually explore. Here's the whole thing, start to finish.",
    caption: "How Adonmo works",
    async run(c) {
      await c.sleep(900);
    },
  },
  {
    id: "02-login",
    say: "Sign in with the team's shared password.",
    caption: "Sign in",
    async run(c) {
      await c.waitFor(`document.querySelector('.login-card input')`);
      await c.moveTo(".login-card input");
      await c.click(".login-card input");
      await c.typeText(".login-card input", c.password, 75);
      await c.sleep(500);
      await c.moveTo(".login-card button");
      await c.click(".login-card button");
      await c.waitFor(`document.querySelector('.dash-shell')`, 30000);
      await c.waitFor(`document.querySelector('.stat-card-value')`, 40000);
      await c.sleep(900);
    },
  },
  {
    id: "03-upload",
    say: "To build a campaign, click Upload campaign sheet. Enter the client's name and a campaign name, then attach your inventory sheet with the rows you aren't pitching deleted. One tab per city.",
    caption: "Upload the shortlist",
    async run(c) {
      await c.moveTo(".dash-upload-btn");
      await c.sleep(400);
      await c.click(".dash-upload-btn");
      await c.waitFor(`document.querySelector('.upload-form')`);
      await c.sleep(700);

      const inputs = ".upload-form input";
      await c.moveToNth(inputs, 0);
      await c.clickNth(inputs, 0);
      await c.typeNth(inputs, 0, c.demo.client, 60);
      await c.sleep(350);
      await c.moveToNth(inputs, 1);
      await c.clickNth(inputs, 1);
      await c.typeNth(inputs, 1, c.demo.campaign, 60);
      await c.sleep(500);

      await c.moveTo('.upload-form input[type="file"]');
      await c.sleep(400);
      await c.attachFile('.upload-form input[type="file"]', c.sheetPath);
      await c.sleep(1200);
    },
  },
  {
    id: "04-submit",
    say: "Upload it. Every row is matched against your live inventory, so only properties you genuinely have come through.",
    caption: "Matched against live inventory",
    async run(c) {
      await c.moveTo('.upload-form button[type="submit"]');
      await c.sleep(300);
      await c.click('.upload-form button[type="submit"]');
      await c.waitFor(`document.querySelector('.upload-result') || document.querySelector('.cpg-map-frame')`, 60000);
      await c.sleep(1200);
    },
  },
  {
    id: "05-map",
    say: "And there's the campaign. Their properties in blue, on a real three-dimensional map. Everything else you have sits behind in green, for context. Screens, households and monthly budget are totalled along the top.",
    caption: "Their shortlist, live on the map",
    async run(c) {
      await c.ensureCampaignOpen();
      await c.waitForMap();
      await c.sleep(1500);
    },
  },
  {
    id: "06-tour",
    say: "Press Tour the shortlist, and it flies from property to property on its own, stopping on each one with its numbers. Start it on a client call and just talk.",
    caption: "Press play — it presents for you",
    async run(c) {
      await c.moveTo(".campaign-banner-tour");
      await c.sleep(400);
      await c.click(".campaign-banner-tour");
      await c.sleep(13000);
    },
  },
  {
    id: "07-edit",
    say: "Clients change their minds, and you don't need a new sheet for that. Edit shortlist lets you drop properties, or search and add new ones from any city.",
    caption: "Edit it without re-uploading",
    async run(c) {
      await c.stopTour();
      await c.moveToText(".cpg-copy-link-btn", "edit shortlist");
      await c.sleep(400);
      await c.clickText(".cpg-copy-link-btn", "edit shortlist");
      await c.waitFor(`document.querySelector('.esm-card')`);
      await c.sleep(1000);

      await c.moveToNth(".esm-remove-btn", 0);
      await c.sleep(500);
      await c.clickNth(".esm-remove-btn", 0);
      await c.sleep(900);
      await c.moveToNth(".esm-remove-btn", 0);
      await c.sleep(400);
      await c.clickNth(".esm-remove-btn", 0);
      await c.sleep(900);

      await c.moveTo(".esm-add input");
      await c.click(".esm-add input");
      await c.typeText(".esm-add input", "Lake", 95);
      await c.waitFor(`document.querySelector('.esm-add-btn')`, 20000);
      await c.sleep(900);
      await c.moveToNth(".esm-add-btn", 0);
      await c.sleep(400);
      await c.clickNth(".esm-add-btn", 0);
      await c.sleep(900);
    },
  },
  {
    id: "08-save",
    say: "Save, and the map redraws around the change straight away.",
    caption: "Save — the map updates instantly",
    async run(c) {
      await c.moveTo(".esm-save-btn");
      await c.sleep(400);
      await c.click(".esm-save-btn");
      await c.waitFor(`!document.querySelector('.esm-card')`, 30000);
      await c.waitForMap(900);
      await c.sleep(900);
    },
  },
  {
    id: "09-share",
    say: "When it's ready, copy the client link. That's one URL — no login, nothing for them to install.",
    caption: "One link to send",
    async run(c) {
      await c.moveToText(".cpg-copy-link-btn", "copy client link");
      await c.sleep(400);
      await c.clickText(".cpg-copy-link-btn", "copy client link");
      await c.sleep(1500);
    },
  },
  {
    id: "10-client",
    say: "This is what your client opens. Full screen, their own logo on it, and the same guided tour so they can walk it again after the call.",
    caption: "What your client sees",
    async run(c) {
      await c.openClientLink();
      await c.waitForMap();
      await c.sleep(1500);
    },
  },
  {
    id: "11-inventory",
    say: "Outside of any campaign, browse your whole portfolio across twenty-one cities. Market Insights shows where your reach actually is, and Reports exports every campaign to CSV or PDF.",
    caption: "Everything else: inventory, insights, reports",
    async run(c) {
      await c.backToApp();
      await c.moveToText(".dash-nav-item", "inventory");
      await c.sleep(300);
      await c.clickText(".dash-nav-item", "inventory");
      await c.waitFor(`document.querySelector('.dm-canvas')`, 30000);
      await c.waitForMap(600);
      await c.sleep(1800);
      await c.moveToText(".dash-nav-item", "market insights");
      await c.sleep(300);
      await c.clickText(".dash-nav-item", "market insights");
      await c.waitFor(`document.querySelector('.insights-bar-row')`, 40000);
      await c.sleep(2200);
      await c.moveToText(".dash-nav-item", "reports");
      await c.sleep(300);
      await c.clickText(".dash-nav-item", "reports");
      await c.waitFor(`document.querySelector('.reports-table')`, 30000);
      await c.sleep(1800);
    },
  },
  {
    id: "12-close",
    say: "That's it. Upload the sheet you already have, and send your client a map they'll remember. It's all under Help and FAQs whenever you need it again.",
    caption: "Stop sending spreadsheets",
    async run(c) {
      await c.moveToText(".dash-nav-item", "help");
      await c.sleep(300);
      await c.clickText(".dash-nav-item", "help");
      await c.waitFor(`document.querySelector('.help-faq-item')`, 30000);
      await c.sleep(2000);
    },
  },
];

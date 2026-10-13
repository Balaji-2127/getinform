// The walkthrough: what is said, what is shown, and what happens on screen.
//
// Every step is a real interaction against the running app while it is being
// recorded. Each step is:
//   id       also the narration filename (narration/<id>.wav)
//   label    the small step label shown on screen during this step
//   say      the voice-over for this step
//   run      the interaction, given the driver context (see record.mjs)
//
// Written to be *spoken*, by someone showing a colleague the tool — short
// sentences, contractions, "you" — not to be read as documentation. The goal
// is that a sales rep who has never seen the app can watch this once and then
// build, edit and send a campaign on their own, so every step ends with the
// thing they will actually need to do.
//
// What changed from the previous cut, and why:
//   - No sign-in step. Typing a password on camera taught nothing and opened
//     the video on a login box instead of the product.
//   - Update sheet and Add to campaign are shown. They are how a rep grows a
//     campaign after the first upload, and without them the video only
//     covered the first day of using the tool.
//   - The demo campaign starts as one city and is grown to three through
//     Update sheet, so that feature is shown doing the thing it exists for.
//
// A step always lasts at least as long as its narration (record.mjs pads it),
// so the voice is never cut off by the next action.

export const DEMO = {
  client: "Acme Retail",
  campaign: "Festive Launch",
  // Starts as a one-city campaign...
  firstSheet: "hyderabad_shortlist_test.xlsx",
  // ...and is grown to three cities with Update sheet.
  updateSheet: "multi_city_shortlist_test.xlsx",
};

export const steps = [
  {
    id: "01-intro",
    label: null, // the intro title card covers this step
    say: "Here's a quick tour of Adonmo. In the next few minutes, you'll see everything you need. From a client's spreadsheet, to a live map they can actually explore.",
    async run(c) {
      await c.sleep(800);
    },
  },
  {
    id: "02-dashboard",
    label: "Your dashboard",
    say: "This is where you land. Your campaigns, your clients, and the size of your whole inventory, all at a glance. Your most recent campaigns sit just below, so you can pick one straight back up.",
    async run(c) {
      await c.sleep(1500);
      await c.moveTo(".dash-home-panel-wide");
      await c.sleep(1800);
    },
  },
  {
    id: "03-upload",
    label: "Create a campaign",
    say: "To start a campaign, click Upload campaign sheet. Give it the client's name and a campaign name. That's what your client will see. Then attach your shortlist. It's the master sheet you already use, with the properties you're not pitching removed, and one tab per city.",
    async run(c) {
      await c.moveTo(".dash-upload-btn");
      await c.sleep(300);
      await c.click(".dash-upload-btn");
      await c.waitFor(`document.querySelector('.upload-form')`);
      await c.sleep(500);
      await c.focus(".upload-card", 1.32);
      await c.sleep(700);
      const inputs = ".upload-form input";
      await c.moveToNth(inputs, 0);
      await c.clickNth(inputs, 0);
      await c.typeNth(inputs, 0, c.demo.client, 75);
      await c.sleep(400);
      await c.moveToNth(inputs, 1);
      await c.clickNth(inputs, 1);
      await c.typeNth(inputs, 1, c.demo.campaign, 75);
      await c.sleep(600);
      await c.moveTo('.upload-form input[type="file"]');
      await c.sleep(300);
      await c.attachFile('.upload-form input[type="file"]', c.sheet(c.demo.firstSheet));
      await c.sleep(1400);
    },
  },
  {
    id: "04-submit",
    label: "Create a campaign",
    say: "Click upload. Every row is checked against your live inventory, so only real, available properties make it in.",
    async run(c) {
      await c.moveTo('.upload-form button[type="submit"]');
      await c.sleep(300);
      await c.click('.upload-form button[type="submit"]');
      await c.unfocus();
      await c.waitFor(`document.querySelector('.upload-result') || document.querySelector('.cpg-map-frame')`, 60000);
      await c.sleep(800);
    },
  },
  {
    id: "05-map",
    label: "Your client's map",
    say: "And here it is. Your client's properties in blue, on a real 3D map, with the rest of your inventory in green so they can see what else is nearby. The totals up top are the numbers clients always ask for. Screens, households, and monthly budget.",
    async run(c) {
      await c.ensureCampaignOpen();
      await c.waitForMap();
      await c.sleep(1200);
      await c.moveTo(".cpg-banner-row");
      await c.sleep(1500);
    },
  },
  {
    id: "06-tour",
    label: "Present it on a call",
    say: "On a call, press Tour the shortlist. It moves from one property to the next and stops on each one, so you can simply talk your client through it.",
    async run(c) {
      await c.moveTo(".campaign-banner-tour");
      await c.sleep(400);
      await c.click(".campaign-banner-tour");
      await c.sleep(11500);
      await c.stopTour();
    },
  },
  {
    id: "07-edit",
    label: "Make changes",
    say: "If the client wants changes, you don't need a new sheet. Open Edit shortlist, remove anything they don't want, search for anything they'd like to add, and save. The map updates straight away.",
    async run(c) {
      await c.moveToText(".cpg-copy-link-btn", "edit shortlist");
      await c.sleep(300);
      await c.clickText(".cpg-copy-link-btn", "edit shortlist");
      await c.waitFor(`document.querySelector('.esm-card')`);
      await c.focus(".esm-card", 1.18);
      await c.sleep(900);
      await c.moveToNth(".esm-remove-btn", 0);
      await c.sleep(400);
      await c.clickNth(".esm-remove-btn", 0);
      await c.sleep(900);
      await c.moveTo(".esm-add input");
      await c.click(".esm-add input");
      await c.typeText(".esm-add input", "Lake", 110);
      await c.waitFor(`document.querySelector('.esm-add-btn')`, 20000);
      await c.sleep(700);
      await c.moveToNth(".esm-add-btn", 0);
      await c.sleep(300);
      await c.clickNth(".esm-add-btn", 0);
      await c.sleep(800);
      await c.moveTo(".esm-save-btn");
      await c.sleep(300);
      await c.click(".esm-save-btn");
      await c.unfocus();
      await c.waitFor(`!document.querySelector('.esm-card')`, 30000);
      await c.waitForMap(600);
    },
  },
  {
    id: "08-update",
    label: "Add more cities",
    say: "And when they want to expand into more cities, use Update sheet. Upload the new version and choose Add to this campaign. Everything you had stays, and the new cities come in. It's still the same campaign, and the same link.",
    async run(c) {
      await c.moveToText(".cpg-copy-link-btn", "update sheet");
      await c.sleep(300);
      await c.clickText(".cpg-copy-link-btn", "update sheet");
      await c.waitFor(`document.querySelector('.usm-card')`);
      await c.focus(".usm-card", 1.25);
      await c.sleep(800);
      await c.moveTo('.usm-file input[type="file"]');
      await c.sleep(300);
      await c.attachFile('.usm-file input[type="file"]', c.sheet(c.demo.updateSheet));
      await c.sleep(900);
      await c.moveTo(".usm-mode.is-on");
      await c.sleep(900);
      await c.moveTo(".usm-submit");
      await c.sleep(300);
      await c.click(".usm-submit");
      await c.waitFor(`document.querySelector('.usm-result')`, 60000);
      await c.sleep(2600);
      await c.moveTo(".usm-submit");
      await c.click(".usm-submit");
      await c.unfocus();
      await c.waitFor(`document.querySelector('.map-city-switcher')`, 20000);
      await c.sleep(500);
      await c.moveTo(".map-city-switcher");
      await c.sleep(400);
      await c.selectOptionByText(".map-city-switcher", "Bengaluru");
      await c.waitForMap(600);
    },
  },
  {
    id: "09-share",
    label: "Send it to your client",
    say: "When it's ready, copy the client link and send it over. They don't need a login or an app. This is exactly what they'll see, with their own branding on it.",
    async run(c) {
      await c.moveToText(".cpg-copy-link-btn", "copy client link");
      await c.sleep(300);
      await c.clickText(".cpg-copy-link-btn", "copy client link");
      await c.sleep(1200);
      await c.openClientLink();
      await c.waitForMap();
      await c.sleep(800);
    },
  },
  {
    id: "10-inventory",
    label: "Explore your inventory",
    say: "Back in the app, Inventory lets you explore everything you have, city by city. Search for a property, check its numbers, see which clients already have it, and add it straight to any campaign.",
    async run(c) {
      await c.backToApp();
      await c.moveToText(".dash-nav-item", "inventory");
      await c.sleep(300);
      await c.clickText(".dash-nav-item", "inventory");
      await c.waitFor(`document.querySelector('.dm-search input')`, 30000);
      await c.waitForMap(600);
      await c.moveTo(".dm-search input");
      await c.click(".dm-search input");
      await c.typeText(".dm-search input", "Hills", 110);
      await c.waitFor(`document.querySelector('.dm-search-result')`, 15000);
      await c.sleep(500);
      await c.moveToNth(".dm-search-result", 0);
      await c.sleep(300);
      await c.clickNth(".dm-search-result", 0);
      await c.waitFor(`document.querySelector('.pdp-panel:not(.pdp-empty)')`, 20000);
      await c.sleep(1800);
      await c.focus(".pdp-panel", 1.22);
      await c.moveToText(".pdp-tabs button", "nearby");
      await c.clickText(".pdp-tabs button", "nearby");
      await c.waitFor(`document.querySelector('.pdp-nearby-list, .pdp-nearby-empty')`, 15000);
      await c.sleep(1400);
      await c.moveTo(".pdp-add-btn");
      await c.sleep(300);
      await c.click(".pdp-add-btn");
      await c.waitFor(`document.querySelector('.pdp-picker-item')`, 15000);
      await c.sleep(700);
      await c.moveToNth(".pdp-picker-item", 0);
      await c.sleep(400);
      await c.clickNth(".pdp-picker-item", 0);
      await c.sleep(1400);
      await c.unfocus();
    },
  },
  {
    id: "11-reports",
    label: "Keep track of campaigns",
    say: "Reports keeps every campaign in one place. You can export them to a spreadsheet, open any of them again, or remove the ones you no longer need.",
    async run(c) {
      await c.moveToText(".dash-nav-item", "reports");
      await c.sleep(300);
      await c.clickText(".dash-nav-item", "reports");
      await c.waitFor(`document.querySelector('.reports-table')`, 30000);
      await c.sleep(1000);
      await c.moveTo(".reports-export-btn");
      await c.sleep(1400);
      await c.moveToNth(".reports-open-btn", 0);
      await c.sleep(1100);
      await c.moveToNth(".reports-delete-btn", 0);
      await c.sleep(1100);
    },
  },
  {
    id: "12-close",
    label: "Help whenever you need it",
    say: "And if you ever need a refresher, this video and answers to the most common questions are always under Help and FAQs. That's it. You're ready to build your first campaign.",
    async run(c) {
      await c.moveToText(".dash-nav-item", "help");
      await c.sleep(300);
      await c.clickText(".dash-nav-item", "help");
      await c.waitFor(`document.querySelector('.help-faq-item')`, 30000);
      await c.sleep(1500);
    },
  },
];

// Held after the last line so the outro card can fade in over a still frame
// rather than over the voice.
export const OUTRO_HOLD_SECONDS = 4.5;

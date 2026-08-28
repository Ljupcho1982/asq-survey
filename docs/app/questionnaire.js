/* questionnaire.js — the ACI ASQ Departures instrument, as data.
 *
 * Everything else in the app reads from here: the screens render from SECTIONS,
 * the email fields and the CSV header are derived from the same ids, and the
 * selftest checks this file's shape. Correcting a wording is a one-line edit.
 *
 * Wording marked ✓ below is verbatim from the ACI 2025 annual report for SKP —
 * each per-item ranking slide carries the full Q10 text in its footer. The six
 * items with no ranking slide of their own use the slide-73 scorecard label.
 */
"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Q = api;
})(typeof self !== "undefined" ? self : this, function () {

  /* ---------------------------------------------------------------- scales */

  /* 1 (poor) to 5 (excellent) — the distribution on slide 71 is reported as
     Excellent / Very Good / Good / Fair / Poor, so those are the labels. */
  const SAT_SCALE = [
    { value: 1, label: "Poor" },
    { value: 2, label: "Fair" },
    { value: 3, label: "Good" },
    { value: 4, label: "Very good" },
    { value: 5, label: "Excellent" }
  ];

  /* 1 (not at all) to 5 (extremely) — slide 4. */
  const EMOTION_SCALE = [
    { value: 1, label: "Not at all" },
    { value: 2, label: "Slightly" },
    { value: 3, label: "Moderately" },
    { value: 4, label: "Very" },
    { value: 5, label: "Extremely" }
  ];

  /* Slide 71 footnote defines T2 as "Not at all crowded, Not crowded" and B2 as
     "Crowded, Very crowded" on a 5-pt scale, which fixes both ends and the middle. */
  const CROWD_SCALE = [
    { value: 1, label: "Not at all crowded" },
    { value: 2, label: "Not crowded" },
    { value: 3, label: "Neither" },
    { value: 4, label: "Crowded" },
    { value: 5, label: "Very crowded" }
  ];

  const NOT_APPLICABLE = "na";

  /* ------------------------------------------------------------ categories */

  const CATEGORIES = [
    { id: "arrival",    name: "Arrival at the Airport" },
    { id: "checkin",    name: "Check-in" },
    { id: "security",   name: "Security Screening" },
    { id: "border",     name: "Border / Passport Control" },
    { id: "shopping",   name: "Shopping / Dining" },
    { id: "gate",       name: "Gate Areas" },
    { id: "terminal",   name: "Throughout the Airport" },
    { id: "atmosphere", name: "Airport Atmosphere" }
  ];

  /* ----------------------------------------------- the 31 satisfaction items
   * `label` is what the passenger reads; `short` is the compact scorecard name
   * used in the importance picker, the CSV header and the email table.
   */
  const ITEMS = [
    /* Arrival at the Airport — 3 */
    { id: "arr_ease",            cat: "arrival",  short: "Ease of getting to the airport",
      label: "Ease of getting to the airport" },
    { id: "arr_signage",         cat: "arrival",  short: "Signage to access terminal",
      label: "Signage to access the terminal" },
    { id: "arr_vfm_transport",   cat: "arrival",  short: "VFM: Transport",
      label: "Value for money of the selected mode of transport (including parking facilities)" },

    /* Check-in — 3 */
    { id: "chk_find",            cat: "checkin",  short: "Ease of finding check-in area",
      label: "Ease of finding your check-in area" },
    { id: "chk_wait",            cat: "checkin",  short: "Waiting time: Check-in",
      label: "Waiting time at check-in, including baggage drop if applicable" },
    { id: "chk_staff",           cat: "checkin",  short: "Courtesy & helpfulness: Check-in staff",
      label: "Courtesy and helpfulness of staff in the check-in area" },

    /* Security Screening — 3 */
    { id: "sec_ease",            cat: "security", short: "Ease in security screening",
      label: "Ease of going through security screening" },
    { id: "sec_wait",            cat: "security", short: "Waiting time: Security screening",
      label: "Waiting time at the security screening" },
    { id: "sec_staff",           cat: "security", short: "Courtesy & helpfulness: Security staff",
      label: "Courtesy and helpfulness of security screening staff" },

    /* Border / Passport Control — 2 */
    { id: "bor_wait",            cat: "border",   short: "Waiting time: Border/passport control",
      label: "Waiting time at border/passport control" },
    { id: "bor_staff",           cat: "border",   short: "Courtesy & helpfulness: Border/passport control staff",
      label: "Courtesy and helpfulness of border/passport control staff" },

    /* Shopping / Dining — 5 */
    { id: "shp_restaurants",     cat: "shopping", short: "Restaurants/bars/cafés",
      label: "Restaurants/bars/cafés" },
    { id: "shp_vfm_restaurants", cat: "shopping", short: "VFM: Restaurants/bars/cafés",
      label: "Value for money of restaurants/bars/cafés" },
    { id: "shp_shops",           cat: "shopping", short: "Shops",
      label: "Shops" },
    { id: "shp_vfm_shops",       cat: "shopping", short: "VFM: Shops",
      label: "Value for money of shops" },
    { id: "shp_staff",           cat: "shopping", short: "Courtesy & helpfulness: Shopping and dining staff",
      label: "Courtesy and helpfulness of shopping and dining staff" },

    /* Gate Areas — 2 */
    { id: "gat_comfort",         cat: "gate",     short: "Comfort of waiting at gate areas",
      label: "Comfort of waiting at the gate areas" },
    { id: "gat_seats",           cat: "gate",     short: "Availability of seats at gate areas",
      label: "Availability of seats at the gate areas" },

    /* Throughout the Airport — 10 */
    { id: "thr_wayfinding",      cat: "terminal", short: "Ease of finding way",
      label: "Ease of finding your way" },
    { id: "thr_flightinfo",      cat: "terminal", short: "Availability of flight info.",
      label: "Availability of flight information (gate and time)" },
    { id: "thr_walking",         cat: "terminal", short: "Walking distance inside terminal",
      label: "Walking distance inside the terminal" },
    /* Only asked of connecting passengers — SKP reports it as N/A because almost
       nobody connects there (slide 73). Gated on Q2 at runtime. */
    { id: "thr_connection",      cat: "terminal", short: "Ease of making connection",
      label: "Ease of making your connection with other flights", connectingOnly: true },
    { id: "thr_staff",           cat: "terminal", short: "Courtesy & helpfulness: Airport staff",
      label: "Courtesy and helpfulness of airport staff (information and maintenance staff)" },
    { id: "thr_wifi",            cat: "terminal", short: "Wi-Fi service quality",
      label: "Wi-Fi service quality" },
    { id: "thr_charging",        cat: "terminal", short: "Availability of charging stations",
      label: "Availability of charging stations/points" },
    { id: "thr_entertainment",   cat: "terminal", short: "Entertainment & leisure options",
      label: "Entertainment and leisure options" },
    { id: "thr_washrooms",       cat: "terminal", short: "Availability of washrooms",
      label: "Availability of washrooms/toilets" },
    { id: "thr_washrooms_clean", cat: "terminal", short: "Cleanliness of washrooms",
      label: "Cleanliness of washrooms/toilets" },

    /* Airport Atmosphere — 3 */
    { id: "atm_health",          cat: "atmosphere", short: "Health safety",
      label: "Health safety" },
    { id: "atm_clean",           cat: "atmosphere", short: "Cleanliness",
      label: "Cleanliness" },
    { id: "atm_ambience",        cat: "atmosphere", short: "Ambience",
      label: "Ambience" }
  ];

  /* The 2 overall items (slide 4). Kept out of ITEMS so the 31-item count and the
     importance picker stay faithful to ACI's structure. */
  const OVERALL = [
    { id: "overall_satisfaction", short: "Overall Satisfaction",
      label: "Overall satisfaction with this airport" },
    { id: "overall_experience",   short: "Overall Experience",
      label: "Your overall experience at this airport" }
  ];

  /* ------------------------------------------------------------- emotions
   * !! PLACEHOLDER WORDING !!
   * Slide 4 states the questionnaire carries "5 emotions on a scale from 1 (not
   * at all) to 5 (extremely)" but never names them, and ACI does not publish the
   * instrument. Replace the five labels below with ACI's actual emotions when you
   * have them — nothing else in the app needs to change.
   */
  const EMOTIONS = [
    { id: "emo_happy",      label: "Happy" },
    { id: "emo_relaxed",    label: "Relaxed" },
    { id: "emo_confident",  label: "Confident" },
    { id: "emo_stressed",   label: "Stressed" },
    { id: "emo_frustrated", label: "Frustrated" }
  ];

  /* --------------------------------------------- profiling questions (13)
   * Wording verbatim from the slide footers on pages 68, 69, 72 and 73.
   * The deck never quotes Q4, Q5, Q6, Q14, Q17 or Q18, so they are absent.
   */
  const PROFILE = [
    { id: "q1_destination", q: "Q1", type: "text",
      label: "Which airport are you flying to?",
      placeholder: "City or airport code — e.g. Vienna or VIE" },

    { id: "q2_connection", q: "Q2", type: "single",
      label: "Are you currently making a connection/transfer at THIS airport?",
      options: ["Yes", "No"] },

    { id: "q3_reason", q: "Q3", type: "single",
      label: "What is/was your MAIN reason for this trip?",
      options: ["Business", "Leisure", "Personal"] },

    { id: "q7_transport", q: "Q7", type: "single",
      label: "What is the MAIN mode of transport that you have used to arrive at this airport?",
      options: ["Private/Company car", "Private car dropped off by someone", "Ridesharing",
                "Taxi/Limo", "Bus/Shuttle/Coach", "Rental car", "Other"] },

    { id: "q8_parking", q: "Q8", type: "single",
      label: "Did you use the airport parking facilities?",
      options: ["Used", "Not used"] },

    { id: "q9_checkin_mode", q: "Q9", type: "multi",
      label: "Select ALL modes used to check-in for your next flight.",
      options: ["Online / Mobile check-in", "Check-in desk with airline staff",
                "Self-check-in kiosk at airport", "Self-baggage drop-off at airport", "Other"] },

    { id: "q12_arrival_time", q: "Q12", type: "single",
      label: "If connecting, how long was your connection/transfer? Otherwise, how long before the scheduled departure time of your flight did you arrive at THIS airport?",
      options: ["Less than 1 hr", "1 hr – 1 hr 30 min", "1 hr 31 min – 2 hrs",
                "2 hrs – 3 hrs", "3 hrs – 5 hrs", "More than 5 hrs"] },

    { id: "q13_group", q: "Q13", type: "multi",
      label: "With whom are you travelling today?",
      options: ["Alone", "With colleague(s)", "With friend(s) or relative(s)",
                "With children aged 0-2", "With children aged 3-9", "With children aged 10-17"] },

    { id: "q15_flight_status", q: "Q15", type: "single",
      label: "At the time of completing this survey, is your flight scheduled to depart on time?",
      options: ["On time", "Delayed", "Did not know"] },

    { id: "q16_return_trips", q: "Q16", type: "single",
      label: "Including this trip, how many return trips by air have you made to any destination in the past 12 months?",
      options: ["1-2", "3-5", "6-10", "11-20", "21 or more"] },

    { id: "q19_age", q: "Q19", type: "single",
      label: "What is your age group?",
      options: ["16-24", "25-34", "35-44", "45-54", "55-64", "65-74", "75 & over"] },

    { id: "q20_gender", q: "Q20", type: "single",
      label: "Are you…",
      options: ["Male", "Female", "Other", "Prefer not to say"] },

    /* Q11 is the importance picker; it has its own screen because it draws on the
       31 items rather than a fixed option list, but it counts as one of the 13. */
    { id: "q11_important", q: "Q11", type: "importance",
      label: "Based on your experience at THIS airport, select your 3 most IMPORTANT items.",
      max: 3 }
  ];

  const CROWD = { id: "crowd", type: "scale", scale: CROWD_SCALE,
    label: "How crowded did you find the airport today?" };

  const OPEN_ENDED = [
    { id: "open_liked",   label: "What did you like most about your experience at this airport today?" },
    { id: "open_improve", label: "What could this airport do to improve your experience?" }
  ];

  /* ---------------------------------------------------------------- helpers */

  function profile(id) { return PROFILE.find((p) => p.id === id) || null; }
  function item(id) { return ITEMS.find((i) => i.id === id) || null; }
  function itemsIn(catId) { return ITEMS.filter((i) => i.cat === catId); }

  /* Every question the app can ask, in the order it asks them. The CSV header,
     the email table and the selftest all derive their ordering from this, so the
     columns stay stable across submissions no matter what was left blank. */
  function questionOrder() {
    const ids = [];
    ["q1_destination", "q2_connection", "q3_reason", "q7_transport", "q8_parking",
     "q9_checkin_mode", "q12_arrival_time"].forEach((id) => ids.push(id));
    CATEGORIES.forEach((c) => itemsIn(c.id).forEach((i) => ids.push(i.id)));
    OVERALL.forEach((o) => ids.push(o.id));
    ids.push("q11_important");
    EMOTIONS.forEach((e) => ids.push(e.id));
    ids.push(CROWD.id);
    ["q13_group", "q15_flight_status", "q16_return_trips", "q19_age", "q20_gender"]
      .forEach((id) => ids.push(id));
    OPEN_ENDED.forEach((o) => ids.push(o.id));
    return ids;
  }

  /* Human-readable name for any question id — used for the email table and the
     CSV header, so a recipient never has to look up what `thr_wifi` means. */
  function labelFor(id) {
    const it = item(id);            if (it) return it.short;
    const ov = OVERALL.find((o) => o.id === id); if (ov) return ov.short;
    const em = EMOTIONS.find((e) => e.id === id); if (em) return "Emotion: " + em.label;
    if (id === CROWD.id) return "Perception of crowd";
    const oe = OPEN_ENDED.find((o) => o.id === id); if (oe) return oe.label;
    const pr = profile(id);         if (pr) return pr.q + " " + pr.label;
    return id;
  }

  /* ---------------------------------------------------------------- screens
   * The flow, as data. app.js walks this array; adding or reordering a screen
   * needs no change to the renderer.
   */
  const SCREENS = [
    { id: "welcome", kind: "welcome" },
    { id: "trip",    kind: "profile", title: "Your trip",
      questions: ["q1_destination", "q2_connection", "q3_reason"] },
    { id: "journey", kind: "profile", title: "Getting here",
      questions: ["q7_transport", "q8_parking", "q9_checkin_mode", "q12_arrival_time"] }
  ];
  CATEGORIES.forEach((c) => SCREENS.push({ id: "cat_" + c.id, kind: "rating", category: c.id, title: c.name }));
  SCREENS.push(
    { id: "overall",   kind: "overall",    title: "Overall" },
    { id: "important", kind: "importance", title: "What mattered most" },
    { id: "emotions",  kind: "emotions",   title: "How you feel right now" },
    { id: "crowd",     kind: "crowd",      title: "The airport today" },
    { id: "about",     kind: "profile",    title: "About you",
      questions: ["q13_group", "q15_flight_status", "q16_return_trips", "q19_age", "q20_gender"] },
    { id: "comments",  kind: "open",       title: "Anything else?" },
    { id: "thanks",    kind: "thanks" }
  );

  return {
    SAT_SCALE, EMOTION_SCALE, CROWD_SCALE, NOT_APPLICABLE,
    CATEGORIES, ITEMS, OVERALL, EMOTIONS, PROFILE, CROWD, OPEN_ENDED, SCREENS,
    item, itemsIn, profile, questionOrder, labelFor
  };
});

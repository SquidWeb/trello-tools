/*
  Planyway list extractor (run in browser DevTools)
  - Open Planyway, TimeTracking, and switch to list view
  - Open the browser Developer Tools Console and paste the contents of this file
  - It prints a table and copies today's rows to your clipboard (if `copy` is available)
  - Paste the JSON into `today.json` in this repo to use for the daily report
  - Quick tweaks: adjust MODE and CUTOFF_HOUR_LOCAL at the bottom before pasting
*/
(function () {
  function getRowsWithOptions(options = {}) {
    // Options: { mode: 'auto' | 'today_only' | 'today_plus_yesterday', cutoffHourLocal: 3 }
    const { mode = "auto", cutoffHourLocal = 3 } = options;
    const items = Array.from(document.querySelectorAll("[data-item-index]"));

    const DAY_RE = /(Sun|Mon|Tue|Wed|Thu|Fri|Sat),/i;
    const isHeader = (el) => {
      const txt = (el.textContent || "").trim();
      if (!txt) return false;
      return (
        txt.includes("Today") || txt.includes("Yesterday") || DAY_RE.test(txt)
      );
    };

    const headerType = (el) => {
      const txt = (el.textContent || "").trim();
      console.log({txt});
      if (txt.includes("Today")) return "Today";
      if (txt.includes("Yesterday")) return "Yesterday";
      if (/Fri/.test(txt)) return "Yesterday";
      if (DAY_RE.test(txt)) return "Other";
      return null;
    };

    const extractRow = (el) => {
      const container = el.querySelector(":scope > div");
      if (!container) return null;
      const cols = Array.from(container.querySelectorAll(":scope > div"));
      if (cols.length < 3) return null;

      const nameDivs = Array.from(
        cols[1]?.querySelectorAll(":scope > div") || []
      );
      const name = (
        nameDivs[1]?.textContent ||
        nameDivs[0]?.textContent ||
        ""
      ).trim();
      if (!name) return null;

      const { date, time } = (function parseDateTime(section) {
        if (!section) return { date: "", time: "" };
        const MONTH_RE =
          /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2}/i;
        const TIME_RE = /(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/i; // accepts "1h 23m", "45m", "2h"

        const texts = [];
        section.querySelectorAll("p,div,span").forEach((n) => {
          const t = (n.textContent || "").trim();
          if (t) texts.push(t);
        });
        const inputs = Array.from(section.querySelectorAll("input"));

        // Prefer specific picks:
        // 1) Date: first text matching MONTH_RE
        const dateFromText = texts.find((t) => MONTH_RE.test(t)) || "";

        // 2) Time: prefer an input value that looks like time; else any text matching time
        let timeFromInput = "";
        for (const inp of inputs) {
          const v = (inp.value || "").trim();
          if (v && /h|m/i.test(v)) {
            timeFromInput = v;
            break;
          }
        }
        const timeFromText =
          texts.find((t) => /\d\s*h|\d\s*m|\d+h|\d+m/i.test(t)) || "";

        const dateFinal = dateFromText || "";
        const timeFinal = timeFromInput || timeFromText || "";
        return { date: dateFinal, time: timeFinal };
      })(cols[2]);

      if (!date && !time) return null;
      return { date, name, time };
    };

    // Build sections grouped by headers appearing in the list
    const sections = [];
    let current = null;
    for (const el of items) {
      if (isHeader(el)) {
        const type = headerType(el);
        current = { type, label: (el.textContent || "").trim(), rows: [] };
        sections.push(current);
        continue;
      }
      if (current) {
        const row = extractRow(el);
        if (row) current.rows.push(row);
      }
    }

    // Decide which sections to include
    const now = new Date();
    const hour = now.getHours();
    let includeToday = false;
    let includeYesterday = false;

    if (mode === "today_only") {
      includeToday = true;
    } else if (mode === "today_plus_yesterday") {
      includeToday = true;
      includeYesterday = true;
    } else {
      // auto
      if (hour < Number(cutoffHourLocal)) {
        includeToday = true;
        includeYesterday = true;
      } else {
        includeToday = true;
      }
    }

    const out = [];
    for (const sec of sections) {
      console.log(sec);
      if (sec.type === "Today" && includeToday) out.push(...sec.rows);
      if (sec.type === "Yesterday" && includeYesterday) out.push(...sec.rows);
    }

    // fallback
    if (out.length === 0) {
      const todaySec = sections.find((s) => s.type === "Today");
      const ySec = sections.find((s) => s.type === "Yesterday");
      if (includeToday && todaySec) out.push(...todaySec.rows);
      else if (includeYesterday && ySec) out.push(...ySec.rows);
    }

    return out;
  }

  // For DevTools usage: tweak these two to adjust behavior quickly when pasting
  const MODE = "today_only"; // 'auto' | 'today_only' | 'today_plus_yesterday'
  const CUTOFF_HOUR_LOCAL = 6; // before this hour, include yesterday too in auto mode

  try {
    const rows = getRowsWithOptions({
      mode: MODE,
      cutoffHourLocal: CUTOFF_HOUR_LOCAL,
    });
    if (typeof console !== "undefined" && console.table) console.table(rows);
    if (typeof copy === "function") copy(rows);
  } catch (e) {
    console.warn("getRows post-run failed:", e);
  }
})();


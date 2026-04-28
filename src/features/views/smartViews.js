/**
 * smartViews.js
 * Pure helper functions for smart filtered views.
 * All functions are safe with undefined/null input — always return arrays.
 * No React, no side effects, no database calls, no imports.
 *
 * Goal: prepare filtered data sets so mobile users see
 * only what they need to act on, not hundreds of leads.
 */

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Returns today's date string in YYYY-MM-DD format */
export const getToday = () => new Date().toISOString().split("T")[0];

/** Safe array coercion — always returns an array */
const safe = (arr) => (Array.isArray(arr) ? arr : []);

// ─── Job views ───────────────────────────────────────────────────────────────

/**
 * Jobs scheduled or in-progress for today.
 * Includes in-progress jobs regardless of date (they started today or are running over).
 *
 * @param {Array} jobs
 * @returns {Array}
 */
export function getTodayJobs(jobs) {
  const today = getToday();
  return safe(jobs).filter(
    (j) => j?.date === today || j?.status === "in-progress"
  );
}

/**
 * Jobs scheduled for future dates (not today, not completed, not cancelled).
 * Sorted ascending by date so the next job is always first.
 *
 * @param {Array} jobs
 * @returns {Array}
 */
export function getUpcomingJobs(jobs) {
  const today = getToday();
  return safe(jobs)
    .filter((j) => j?.status === "scheduled" && j?.date > today)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

/**
 * Jobs that are completed.
 * Sorted descending so the most recent completion is first.
 *
 * @param {Array} jobs
 * @returns {Array}
 */
export function getCompletedJobs(jobs) {
  return safe(jobs)
    .filter((j) => j?.status === "completed")
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

/**
 * Jobs that are completed but have no payment confirmed.
 * These are the ones the owner needs to chase for payment.
 *
 * @param {Array} jobs
 * @returns {Array}
 */
export function getNeedsPaymentJobs(jobs) {
  return safe(jobs).filter(
    (j) => j?.status === "completed" && !j?.paymentConfirmed
  );
}

// ─── Lead views ──────────────────────────────────────────────────────────────

/**
 * Leads with status "New" that have never been quoted.
 * These are the most urgent — fresh intake that needs a response.
 *
 * @param {Array} leads
 * @returns {Array}
 */
export function getNeedsQuoteLeads(leads) {
  return safe(leads).filter(
    (l) => !l?.status || l?.status === "New"
  );
}

/**
 * Leads that need a follow-up.
 * Includes:
 *  - status === "Follow Up"
 *  - status === "Quoted" and followUpDate is today or in the past
 *  - followUpDate is set and is today or overdue
 *
 * @param {Array} leads
 * @returns {Array}
 */
export function getFollowUpLeads(leads) {
  const today = getToday();
  return safe(leads).filter((l) => {
    if (!l) return false;
    if (l.status === "Follow Up") return true;
    if (l.followUpDate && l.followUpDate <= today) return true;
    if (l.status === "Quoted" && l.followUpDate && l.followUpDate <= today) return true;
    return false;
  });
}

// ─── Composite smart views ───────────────────────────────────────────────────

/**
 * Returns a summary object of all smart view counts.
 * Useful for badge counts in navigation or dashboard widgets.
 *
 * @param {Array} jobs
 * @param {Array} leads
 * @returns {Object}
 */
export function getSmartViewCounts(jobs, leads) {
  return {
    todayJobs:       getTodayJobs(jobs).length,
    upcomingJobs:    getUpcomingJobs(jobs).length,
    completedJobs:   getCompletedJobs(jobs).length,
    needsPayment:    getNeedsPaymentJobs(jobs).length,
    needsQuote:      getNeedsQuoteLeads(leads).length,
    followUp:        getFollowUpLeads(leads).length,
  };
}

/**
 * Returns the full smart view data in one call.
 * Useful for passing to a dashboard or mobile home screen.
 *
 * @param {Array} jobs
 * @param {Array} leads
 * @returns {Object}
 */
export function getAllSmartViews(jobs, leads) {
  return {
    todayJobs:       getTodayJobs(jobs),
    upcomingJobs:    getUpcomingJobs(jobs),
    completedJobs:   getCompletedJobs(jobs),
    needsPaymentJobs: getNeedsPaymentJobs(jobs),
    needsQuoteLeads: getNeedsQuoteLeads(leads),
    followUpLeads:   getFollowUpLeads(leads),
  };
}

/**
 * jobUtils.js
 * Pure utility functions for job filtering and display helpers.
 * No React, no side effects, no database calls.
 */

/**
 * Filter jobs by status.
 * @param {Array}  jobs   - Full jobs array
 * @param {string} filter - "all" or a specific status string
 * @returns {Array} filtered jobs
 */
export function filterJobs(jobs, filter) {
  if (!Array.isArray(jobs)) return [];
  return filter === "all" ? jobs : jobs.filter(j => j.status === filter);
}

/**
 * Resolve partner objects from a job's partnerIds or partnerId.
 * @param {Object} job      - job object
 * @param {Array}  partners - full partners array
 * @returns {Array} resolved partner objects
 */
export function getJobPartners(job, partners) {
  if (!job || !Array.isArray(partners)) return [];
  const ids = job.partnerIds || (job.partnerId ? [job.partnerId] : []);
  return ids.map(id => partners.find(p => p.id === id)).filter(Boolean);
}

/**
 * Returns a display label for a job status filter tab.
 * @param {string} filter
 * @returns {string}
 */
export function filterLabel(filter) {
  if (filter === "all") return "All Jobs";
  return filter.charAt(0).toUpperCase() + filter.slice(1);
}

/** All valid job status filters */
export const JOB_FILTERS = ["all", "scheduled", "in-progress", "completed"];

/**
 * Shared secret the dashboard's server-side routes send to Modal's dashboard-facing
 * endpoints (enrich_startup, submit_feedback, cancel/reschedule_scheduled_task).
 *
 * Those endpoints are public URLs that Modal doesn't gate on anything, so they used
 * to be callable by anyone who knew them — kicking off paid Exa/LLM work or
 * canceling the agent's scheduled runs. modal_app.py's _check_dashboard_secret now
 * requires this value in the request body.
 *
 * Server-only: never import this from a "use client" component, and never send the
 * value to the browser. Falls back to SCHEDULER_SHARED_SECRET so a deployment
 * running a single shared secret works without adding a second one.
 */
export function modalSecret(): string {
  return (
    process.env.DASHBOARD_SHARED_SECRET ||
    process.env.SCHEDULER_SHARED_SECRET ||
    ""
  );
}

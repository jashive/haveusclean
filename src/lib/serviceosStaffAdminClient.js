import { getValidAccessToken } from "./serviceosAuthClient.js";

async function parseResponse(response) {
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!response.ok) {
    const error = new Error(data?.error || `Staff administration request failed (${response.status})`);
    error.code = data?.code || "STAFF_ADMIN_REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }
  return data;
}

async function staffAdminFetch(options = {}) {
  const token = await getValidAccessToken();
  const response = await fetch("/api/serviceos-staff-admin", {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  return parseResponse(response);
}

export function loadStaffDirectory() {
  return staffAdminFetch({ method: "GET" });
}

export function inviteStaffMember({ displayName, email, roleCode, businessUnitCode }) {
  return staffAdminFetch({
    method: "POST",
    body: JSON.stringify({ action: "invite", displayName, email, roleCode, businessUnitCode }),
  });
}

export function deactivateStaffMember(appUserId) {
  return staffAdminFetch({
    method: "POST",
    body: JSON.stringify({ action: "deactivate", appUserId }),
  });
}

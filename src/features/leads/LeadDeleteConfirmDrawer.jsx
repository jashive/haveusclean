import React from "react";
import ConfirmDrawer from "../../components/ConfirmDrawer";

export default function LeadDeleteConfirmDrawer({
  open,
  onConfirm,
  onCancel,
  title = "Delete this lead?",
  message = "This cannot be undone. The lead will be permanently removed.",
}) {
  return (
    <ConfirmDrawer
      open={open}
      title={title}
      message={message}
      confirmLabel="Yes, Delete"
      cancelLabel="Keep Lead"
      variant="danger"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}